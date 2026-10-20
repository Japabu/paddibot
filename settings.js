import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Only known boolean settings are read, so old files remain compatible as settings are added.
export class SettingsStore {
	constructor(path, defaults) {
		this.path = path;
		this.defaults = defaults;
		try {
			this.guilds = JSON.parse(readFileSync(path, 'utf8'));
			if (!this.guilds || typeof this.guilds !== 'object' || Array.isArray(this.guilds)) throw new Error('Expected a settings object');
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			this.guilds = {};
		}
	}

	get(guildId) {
		return Object.fromEntries(Object.entries(this.defaults).map(([key, value]) =>
			[key, typeof this.guilds[guildId]?.[key] === 'boolean' ? this.guilds[guildId][key] : value]));
	}

	update(guildId, changes) {
		const next = { ...this.get(guildId) };
		for (const [key, value] of Object.entries(changes)) {
			if (Object.hasOwn(this.defaults, key) && typeof value === 'boolean') next[key] = value;
		}
		const guilds = { ...this.guilds, [guildId]: next };
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(`${this.path}.tmp`, JSON.stringify(guilds, null, 2));
		renameSync(`${this.path}.tmp`, this.path);
		this.guilds = guilds;
		return next;
	}
}
