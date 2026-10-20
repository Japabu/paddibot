// Queue and recommendation transitions are independent of Discord and the extractor.
export class PlaybackSession {
	constructor({ play, recommend, update, onError = console.error }) {
		Object.assign(this, { play, recommend, update, onError });
		this.version = 0;
		this.reset();
	}

	reset() {
		this.version++;
		this.active = false;
		this.queue = [];
		this.index = 0;
		this.current = null;
		this.loop = false;
		this.history = new Set();
		this.advancing = null;
		this.waitingForEnd = false;
		this.endedWhileUpdating = false;
	}

	start({ tracks, title = '', loop = false, autoplay = false }) {
		this.reset();
		Object.assign(this, { queue: tracks, title, loop, autoplay, active: true });
		return this.advance();
	}

	advance() {
		if (!this.active) return Promise.resolve(false);
		if (this.advancing) return this.advancing;
		const version = this.version;
		const task = this.advanceOnce(version).catch(error => {
			this.onError(error);
			if (this.version === version) return this.update('❌ Could not load the next track. Try another YouTube link.');
			return false;
		}).finally(() => {
			if (this.version === version) {
				this.advancing = null;
				if (this.endedWhileUpdating) {
					this.endedWhileUpdating = false;
					void this.advance();
				}
			}
		});
		this.advancing = task;
		return task;
	}

	onIdle() {
		if (!this.active || !this.waitingForEnd) return;
		this.waitingForEnd = false;
		if (this.advancing) this.endedWhileUpdating = true;
		else void this.advance();
	}

	async advanceOnce(version) {
		const valid = () => this.active && this.version === version;
		let recommendations = null;
		for (let attempts = 0; valid(); attempts++) {
			let track;
			let recommended = false;
			if (this.loop && this.current) track = this.current;
			else if (this.index < this.queue.length) track = this.queue[this.index++];
			else if (this.autoplay && this.current && attempts < 5) {
				if (!recommendations) {
					await this.update('⏳ Finding YouTube recommendations…');
					if (!valid() || !this.autoplay) return false;
					recommendations = await this.recommend(this.current.url);
				}
				if (!valid() || !this.autoplay) return false;
				track = recommendations.find(item => !this.history.has(item.id));
				recommended = true;
			}
			if (!track) {
				await this.update(this.autoplay ? '✅ Finished — no more playable YouTube recommendations.' : '✅ Playback finished.');
				return false;
			}
			this.history.add(track.id);
			if (this.history.size > 100) this.history.delete(this.history.values().next().value);
			const stillCurrent = () => valid() && (!recommended || this.autoplay);
			await this.update(`⏳ Loading: ${track.title}`);
			if (!stillCurrent()) return false;
			this.waitingForEnd = true;
			const success = await this.play(track.url, stillCurrent);
			if (!stillCurrent()) return false;
			if (success) {
				this.current = track;
				const position = recommended ? '📻 YouTube recommendations' : this.loop ? '🔁 Loop' : `📍 ${this.index}/${this.queue.length}`;
				const heading = this.title && this.title !== 'YouTube' ? `🎶 **${this.title}**\n\n` : '';
				await this.update(`${heading}🎵 **Now Playing:** ${track.title}\n${position}\n🔗 ${track.url}`);
				return true;
			}
			this.waitingForEnd = false;
			if (this.loop) {
				await this.update('❌ Could not play the looped track.');
				return false;
			}
		}
		return false;
	}
}
