import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackSession } from '../playback.js';
import { isYouTubeUrl, playableEntries, videoId } from '../youtube.js';

const track = id => ({ id, title: id, url: `https://www.youtube.com/watch?v=${id}` });
const a = track('aaaaaaaaaaa'), b = track('bbbbbbbbbbb'), c = track('ccccccccccc');
function setup(options = {}) {
	const played = [], messages = [], recommended = [];
	const session = new PlaybackSession({
		play: async (url, valid) => { if (valid()) played.push(url); return valid(); },
		recommend: async url => { recommended.push(url); return [a, b, c]; },
		update: async message => { messages.push(message); }, ...options,
	});
	return { session, played, messages, recommended };
}
function deferred() {
	let resolve;
	const promise = new Promise(done => { resolve = done; });
	return { promise, resolve };
}

test('autoplay is off by default and the final track is not marked finished early', async () => {
	const { session, played, recommended, messages } = setup();
	await session.start({ tracks: [a] });
	assert.match(messages.at(-1), /Now Playing/);
	await session.advance();
	assert.deepEqual(played, [a.url]);
	assert.deepEqual(recommended, []);
	assert.match(messages.at(-1), /Playback finished/);
});

test('queued tracks play before recommendations and history prevents repeats', async () => {
	const { session, played, recommended } = setup();
	await session.start({ tracks: [a, b], autoplay: true });
	await session.advance();
	assert.equal(recommended.length, 0);
	await session.advance();
	await session.advance();
	assert.deepEqual(played, [a.url, b.url, c.url]);
	assert.deepEqual(recommended, [b.url, c.url]);
});

test('loops take precedence over autoplay', async () => {
	const { session, played, recommended } = setup();
	await session.start({ tracks: [a], autoplay: true, loop: true });
	await session.advance();
	assert.deepEqual(played, [a.url, a.url]);
	assert.equal(recommended.length, 0);
});

test('unavailable recommendations are skipped and failures are bounded', async () => {
	let attempts = 0;
	const { session, messages } = setup({
		play: async () => ++attempts === 1,
		recommend: async () => Array.from({ length: 20 }, (_, i) => track(`candidate${i}`)),
	});
	await session.start({ tracks: [a], autoplay: true });
	await session.advance();
	assert.equal(attempts, 6);
	assert.match(messages.at(-1), /no more playable/);
});

test('Stop while recommendations load prevents playback', async () => {
	const pending = deferred();
	const { session, played } = setup({ recommend: () => pending.promise });
	await session.start({ tracks: [a], autoplay: true });
	const next = session.advance();
	await new Promise(setImmediate);
	session.reset();
	pending.resolve([b]);
	await next;
	assert.deepEqual(played, [a.url]);
	assert.equal(session.active, false);
});

test('turning autoplay off cancels pending recommendations', async () => {
	const pending = deferred();
	const { session, played } = setup({ recommend: () => pending.promise });
	await session.start({ tracks: [a], autoplay: true });
	const next = session.advance();
	await new Promise(setImmediate);
	session.autoplay = false;
	pending.resolve([b]);
	await next;
	assert.deepEqual(played, [a.url]);
});

test('new playback supersedes an old pending recommendation request', async () => {
	const pending = deferred();
	const { session, played } = setup({ recommend: () => pending.promise });
	await session.start({ tracks: [a], autoplay: true });
	const old = session.advance();
	await new Promise(setImmediate);
	await session.start({ tracks: [c] });
	pending.resolve([b]);
	await old;
	assert.deepEqual(played, [a.url, c.url]);
	assert.equal(session.current.id, c.id);
});

test('overlapping Idle events share the same transition', async () => {
	const pending = deferred();
	let requests = 0;
	const { session, played } = setup({ recommend: () => { requests++; return pending.promise; } });
	await session.start({ tracks: [a], autoplay: true });
	const first = session.advance(), second = session.advance();
	assert.equal(first, second);
	await new Promise(setImmediate);
	pending.resolve([b]);
	await first;
	assert.equal(requests, 1);
	assert.deepEqual(played, [a.url, b.url]);
});

test('extractor callback becomes invalid if stopped during extraction', async () => {
	const pending = deferred();
	let isCurrent;
	const { session } = setup({ play: async (_, valid) => { isCurrent = valid; await pending.promise; return valid(); } });
	const task = session.start({ tracks: [a] });
	await new Promise(setImmediate);
	assert.equal(isCurrent(), true);
	session.reset();
	assert.equal(isCurrent(), false);
	pending.resolve();
	await task;
	assert.equal(session.current, null);
});

test('recommendation failures are contained and reported', async () => {
	const errors = [];
	const { session, messages } = setup({ recommend: async () => { throw Error('network'); }, onError: error => errors.push(error) });
	await session.start({ tracks: [a], autoplay: true });
	await session.advance();
	assert.equal(errors.length, 1);
	assert.match(messages.at(-1), /Could not load/);
});

test('YouTube links are restricted and supported video forms normalize to IDs', () => {
	assert.equal(isYouTubeUrl('https://youtube.com.evil.test/watch?v=aaaaaaaaaaa'), false);
	assert.equal(isYouTubeUrl('http://192.168.1.1'), false);
	assert.equal(isYouTubeUrl('--exec=bad'), false);
	for (const url of ['https://youtu.be/aaaaaaaaaaa?t=2', 'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLx', 'https://youtube.com/shorts/aaaaaaaaaaa', 'https://youtube.com/live/aaaaaaaaaaa']) {
		assert.equal(videoId(url), a.id);
	}
	assert.equal(videoId('https://youtube.com/playlist?list=PLx'), null);
});

test('unavailable, deleted and live playlist entries are excluded', () => {
	const entries = playableEntries({ entries: [null, { id: a.id, title: 'Song', url: 'https://evil.test' },
		{ id: b.id, title: '[Deleted video]' }, { id: c.id, live_status: 'is_live' }, { id: c.id, availability: 'private' }] });
	assert.deepEqual(entries, [{ ...a, title: 'Song' }]);
});

test('an audio ending during a slow control-panel edit still advances exactly once', async () => {
	const pending = deferred();
	let block = true;
	const { session, played } = setup({ update: async message => {
		if (message.includes('Now Playing') && block) { block = false; await pending.promise; }
	} });
	const start = session.start({ tracks: [a, b] });
	await new Promise(setImmediate);
	session.onIdle();
	session.onIdle();
	pending.resolve();
	await start;
	await new Promise(setImmediate);
	assert.deepEqual(played, [a.url, b.url]);
});
