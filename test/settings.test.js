import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../settings.js';

test('autoplay is off by default, survives restart, and is isolated per server', () => {
	const dir = mkdtempSync(join(tmpdir(), 'paddibot-settings-'));
	try {
		const file = join(dir, 'data/settings.json');
		const store = new SettingsStore(file, { autoplay: false });
		assert.deepEqual(store.get('one'), { autoplay: false });
		store.update('one', { autoplay: true });
		const resumed = new SettingsStore(file, { autoplay: false });
		assert.deepEqual(resumed.get('one'), { autoplay: true });
		assert.deepEqual(resumed.get('two'), { autoplay: false });
		resumed.update('one', { autoplay: false, unknown: true });
		assert.deepEqual(new SettingsStore(file, { autoplay: false }).get('one'), { autoplay: false });
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
