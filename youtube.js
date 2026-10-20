import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const BASE_ARGS = ['--js-runtimes', 'node', '--no-warnings', '--quiet'];
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function isYouTubeUrl(input) {
	try {
		const { protocol, hostname } = new URL(input);
		return ['https:', 'http:'].includes(protocol) && YT_HOSTS.has(hostname);
	} catch { return false; }
}

export function videoId(input) {
	if (!isYouTubeUrl(input)) return null;
	const url = new URL(input);
	const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
	return /^[\w-]{11}$/.test(id ?? '') ? id : null;
}

export function playableEntries(info) {
	return (info.entries ?? []).filter(entry => entry && /^[\w-]{11}$/.test(entry.id)
		&& !['is_live', 'is_upcoming', 'post_live'].includes(entry.live_status)
		&& !['private', 'premium_only', 'subscriber_only', 'needs_auth'].includes(entry.availability)
		&& !/^\[(Private|Deleted) video\]$/i.test(entry.title ?? ''))
		.map(entry => ({ id: entry.id, title: entry.title || entry.id, url: `https://www.youtube.com/watch?v=${entry.id}` }));
}

export async function fetchPlaylist(url, extraArgs = []) {
	if (!isYouTubeUrl(url)) throw new Error('Only YouTube links are supported');
	const { stdout } = await execFileAsync(YT_DLP, [...BASE_ARGS, '--flat-playlist', '--yes-playlist', '-J', ...extraArgs, '--', url], {
		maxBuffer: 32 * 1024 * 1024, timeout: 60_000,
	});
	const info = JSON.parse(stdout);
	return { title: info.title || 'YouTube playlist', items: playableEntries(info) };
}

export async function fetchRecommendations(url) {
	const id = videoId(url);
	if (!id) return [];
	// YouTube's radio mix is generated from the current video; no API key is needed.
	const mix = await fetchPlaylist(`https://www.youtube.com/watch?v=${id}&list=RD${id}`, ['--playlist-end', '25']);
	return mix.items.filter(item => item.id !== id);
}

export function ytAudioStream(url) {
	return new Promise((resolve, reject) => {
		if (!isYouTubeUrl(url)) return reject(new Error('Only YouTube links are supported'));
		const proc = spawn(YT_DLP, [...BASE_ARGS, '--no-playlist', '-f', 'bestaudio[acodec=opus]/bestaudio', '-o', '-', '--', url], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stderr = '';
		let started = false;
		const timeout = setTimeout(() => {
			proc.kill();
			reject(new Error('yt-dlp timed out waiting for audio'));
		}, 60_000);
		proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
		proc.stdout.on('error', () => {});
		const onReadable = () => {
			if (proc.stdout.readableLength === 0) return;
			started = true;
			clearTimeout(timeout);
			proc.stdout.off('readable', onReadable);
			resolve(proc.stdout);
		};
		proc.stdout.on('readable', onReadable);
		proc.stdout.once('close', () => proc.kill());
		proc.on('error', error => { clearTimeout(timeout); reject(error); });
		proc.on('close', code => {
			clearTimeout(timeout);
			if (started) return;
			proc.stdout.off('readable', onReadable);
			reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim()}`));
		});
	});
}
