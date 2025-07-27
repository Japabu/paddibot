import 'dotenv/config';

import { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, demuxProbe, joinVoiceChannel } from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import ytdl from 'ytdl-core';
import ytpl from '@distube/ytpl';

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

const commands = [
	new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Ponggg!'),
	new SlashCommandBuilder()
		.setName('play')
		.setDescription('Plays a vid')
		.addStringOption(option => option
			.setName("url")
			.setDescription("URL")
			.setRequired(true)
		),
	new SlashCommandBuilder()
		.setName('loop')
		.setDescription('Loops a vid')
		.addStringOption(option => option
			.setName("url")
			.setDescription("URL")
			.setRequired(true)
		),
	new SlashCommandBuilder()
		.setName('playlist')
		.setDescription('Plays a YouTube playlist shuffled')
		.addStringOption(option => option
			.setName("url")
			.setDescription("YouTube playlist URL")
			.setRequired(true)
		),
];

const rest = new REST().setToken(process.env.TOKEN);
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

const client = new Client({ intents: [GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates] });

client.on(Events.ShardError, error => {
	console.error('A websocket connection encountered an error:', error);
});
client.on(Events.Error, error => {
	console.error('ERR:', error);
});
client.on(Events.Warn, error => {
	console.error('WARN:', error);
});

client.on(Events.ClientReady, () => {
	console.log(`Logged in as ${client.user.tag}!`);
});



const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

player.on('error', error => {
	console.error('AudioPlayerError:', error);
});

let loopUrl = null;
let currentPlaylist = [];
let currentPlaylistIndex = 0;
let controlMessage = null;
let playlistTitle = "";
let lastAction = "";
let lastActionUser = "";

player.on('stateChange', (_, state) => {
	console.log("stateChange: " + state.status);
	if (state.status === AudioPlayerStatus.Idle) {
		if (loopUrl) {
			playYt(loopUrl);
		} else if (currentPlaylist.length > 0 && currentPlaylistIndex < currentPlaylist.length) {
			playNextInPlaylist();
		}
	}
});

function shuffleArray(array) {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

function createControlButtons() {
	return new ActionRowBuilder()
		.addComponents(
			new ButtonBuilder()
				.setCustomId('skip')
				.setLabel('⏭️ Skip')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('pause')
				.setLabel('⏸️ Pause')
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('resume')
				.setLabel('▶️ Resume')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId('stop')
				.setLabel('⏹️ Stop')
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId('shuffle')
				.setLabel('🔀 Shuffle')
				.setStyle(ButtonStyle.Secondary)
		);
}

async function updateControlMessage(content) {
	if (controlMessage) {
		try {
			let fullContent = content;
			if (lastAction && lastActionUser) {
				fullContent += `\n\n🔧 **Last Action:** ${lastAction} by ${lastActionUser}`;
			}

			await controlMessage.edit({
				content: fullContent,
				components: [createControlButtons()]
			});
		} catch (error) {
			console.error('Failed to update control message:', error);
		}
	}
}

async function playNextInPlaylist() {
	while (currentPlaylistIndex < currentPlaylist.length) {
		const video = currentPlaylist[currentPlaylistIndex];
		console.log(`Attempting to play: ${video.title} (${currentPlaylistIndex + 1}/${currentPlaylist.length})`);

		const nowPlayingMessage = `🎶 **${playlistTitle}**\n\n🎵 **Now Playing:** ${video.title}\n📍 **Position:** ${currentPlaylistIndex + 1}/${currentPlaylist.length}\n🔗 **URL:** ${video.url}`;

		await updateControlMessage(nowPlayingMessage);

		const success = await playYt(video.url);
		currentPlaylistIndex++;

		if (success) {
			console.log(`Successfully started playing: ${video.title}`);
			break; // Successfully playing, exit loop
		} else {
			console.log(`Failed to play: ${video.title}, trying next song...`);

			// Update control message to show skipping failed video
			const skippingMessage = `🎶 **${playlistTitle}**\n\n🎵 **Skipping unavailable:** ${video.title}\n📍 **Position:** ${currentPlaylistIndex}/${currentPlaylist.length}`;
			await updateControlMessage(skippingMessage);

			// Wait a moment before trying next song
			await new Promise(resolve => setTimeout(resolve, 1000));

			// Continue to next song in the loop
		}
	}

	// If we've gone through all songs without success
	if (currentPlaylistIndex >= currentPlaylist.length) {
		await updateControlMessage(`🎶 **${playlistTitle}**\n\n✅ **Playlist finished**`);
	}
}

async function probeAndCreateResource(readableStream) {
	const { stream, type } = await demuxProbe(readableStream);
	return createAudioResource(stream, { inputType: type });
}

function ytAudioStream(url) {
	return ytdl(url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
}


async function playYt(url, retryCount = 0) {
	const maxRetries = 2;

	try {
		const yt = ytAudioStream(url);
		const res = await probeAndCreateResource(yt);
		player.play(res);
		return true; // Success
	} catch (error) {
		console.error(`Error playing ${url}:`, error.message);

		if (error.statusCode === 403 && retryCount < maxRetries) {
			console.log(`Retrying video in ${(retryCount + 1) * 2} seconds...`);
			await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
			return await playYt(url, retryCount + 1);
		}

		return false; // Failed
	}
}

client.on(Events.InteractionCreate, async interaction => {
	// Handle button interactions
	if (interaction.isButton()) {
		// Update last action info
		lastActionUser = interaction.user.displayName || interaction.user.username;

		switch (interaction.customId) {
			case 'skip':
				if (currentPlaylist.length > 0 && currentPlaylistIndex < currentPlaylist.length) {
					lastAction = "⏭️ Skipped to next song";
					player.stop(); // This will trigger the next song via stateChange
				} else {
					lastAction = "❌ Skip failed - no playlist playing";
				}
				break;

			case 'pause':
				if (player.state.status === AudioPlayerStatus.Playing) {
					lastAction = "⏸️ Paused playback";
					player.pause();
					// Update control message immediately for pause
					if (currentPlaylist.length > 0 && currentPlaylistIndex > 0) {
						const video = currentPlaylist[currentPlaylistIndex - 1];
						const pausedMessage = `🎶 **${playlistTitle}**\n\n⏸️ **Paused:** ${video.title}\n📍 **Position:** ${currentPlaylistIndex}/${currentPlaylist.length}\n🔗 **URL:** ${video.url}`;
						await updateControlMessage(pausedMessage);
					}
				} else {
					lastAction = "❌ Pause failed - nothing playing";
				}
				break;

			case 'resume':
				if (player.state.status === AudioPlayerStatus.Paused) {
					lastAction = "▶️ Resumed playback";
					player.unpause();
					// Update control message immediately for resume
					if (currentPlaylist.length > 0 && currentPlaylistIndex > 0) {
						const video = currentPlaylist[currentPlaylistIndex - 1];
						const resumedMessage = `🎶 **${playlistTitle}**\n\n🎵 **Now Playing:** ${video.title}\n📍 **Position:** ${currentPlaylistIndex}/${currentPlaylist.length}\n🔗 **URL:** ${video.url}`;
						await updateControlMessage(resumedMessage);
					}
				} else {
					lastAction = "❌ Resume failed - not paused";
				}
				break;

			case 'stop':
				lastAction = "⏹️ Stopped playback";
				player.stop();
				currentPlaylist = [];
				currentPlaylistIndex = 0;
				loopUrl = null;
				await updateControlMessage('⏹️ **Playback stopped**');
				break;

			case 'shuffle':
				if (currentPlaylist.length > 0) {
					lastAction = "🔀 Shuffled remaining playlist";
					// Shuffle remaining songs
					const remaining = currentPlaylist.slice(currentPlaylistIndex);
					const shuffledRemaining = shuffleArray(remaining);
					currentPlaylist = [...currentPlaylist.slice(0, currentPlaylistIndex), ...shuffledRemaining];
				} else {
					lastAction = "❌ Shuffle failed - no playlist loaded";
				}
				break;
		}

		// Acknowledge the interaction silently (no visible response)
		await interaction.deferUpdate();
		return;
	}

	if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === "ping") {
		await interaction.reply("Pong!");
	} else if (interaction.commandName === "play" || interaction.commandName === "loop" || interaction.commandName === "playlist") {
		// Acknowledge the interaction immediately to prevent timeout
		await interaction.deferReply();

		const url = interaction.options.getString("url");
		console.log(url);

		try {
			const connection = joinVoiceChannel({
				channelId: interaction.member.voice.channel.id,
				guildId: interaction.guild.id,
				adapterCreator: interaction.guild.voiceAdapterCreator,
			});

			connection.on(VoiceConnectionStatus.Ready, () => {
				console.log('The connection has entered the Ready state - ready to play audio!');
			});

			connection.subscribe(player);

			if (interaction.commandName === "play") {
				loopUrl = null;
				currentPlaylist = [];
				currentPlaylistIndex = 0;
				playlistTitle = "";

				const success = await playYt(url);

				if (success) {
					// Create control message for single play
					controlMessage = await interaction.channel.send({
						content: `🎵 **Now Playing:** Single Track\n🔗 **URL:** ${url}`,
						components: [createControlButtons()]
					});
					await interaction.editReply("🎵 Started playing!");
				} else {
					await interaction.editReply("❌ Failed to play this video. It might be unavailable or restricted.");
				}

			} else if (interaction.commandName === "loop") {
				loopUrl = url;
				currentPlaylist = [];
				currentPlaylistIndex = 0;
				playlistTitle = "";

				const success = await playYt(url);

				if (success) {
					// Create control message for loop
					controlMessage = await interaction.channel.send({
						content: `🔁 **Looping:** Single Track\n🔗 **URL:** ${url}`,
						components: [createControlButtons()]
					});
					await interaction.editReply("🔁 Started looping!");
				} else {
					await interaction.editReply("❌ Failed to play this video. It might be unavailable or restricted.");
				}

			} else if (interaction.commandName === "playlist") {
				loopUrl = null;

				try {
					await interaction.editReply("Loading playlist...");

					console.log(`Attempting to load playlist: ${url}`);

					// Retry logic for 403 errors
					let playlist;
					let retryCount = 0;
					const maxRetries = 3;

					while (retryCount < maxRetries) {
						try {
							playlist = await ytpl(url, {
								limit: Infinity,
								requestOptions: {
									headers: {
										'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
									}
								}
							});
							break; // Success, exit retry loop
						} catch (error) {
							retryCount++;
							if (error.statusCode === 403 && retryCount < maxRetries) {
								console.log(`403 error, retrying in ${retryCount * 2} seconds... (${retryCount}/${maxRetries})`);
								await interaction.editReply(`Loading playlist... (retry ${retryCount}/${maxRetries})`);
								await new Promise(resolve => setTimeout(resolve, retryCount * 2000)); // Wait 2, 4, 6 seconds
							} else {
								throw error; // Re-throw if not 403 or max retries reached
							}
						}
					}

					console.log(`Loaded playlist: ${playlist.title} with ${playlist.items.length} items`);

					// Filter out unavailable videos and live streams
					const videos = playlist.items.filter(item => item.id && item.url && !item.isLive);
					console.log(`Filtered to ${videos.length} playable videos`);

					if (videos.length === 0) {
						await interaction.editReply("No playable videos found in this playlist.");
						return;
					}

					// Shuffle the playlist
					currentPlaylist = shuffleArray(videos);
					currentPlaylistIndex = 0;
					playlistTitle = playlist.title;

					// Create persistent control message
					controlMessage = await interaction.channel.send({
						content: `🎶 **${playlist.title}**\n\n⏳ **Loading first song...**\n📍 **Position:** 1/${videos.length}`,
						components: [createControlButtons()]
					});

					await interaction.editReply(`🎶 Created control panel for: **${playlist.title}** (${videos.length} videos)`);

					// Start playing the first video
					await playNextInPlaylist();

				} catch (playlistError) {
					console.error('Error loading playlist:', playlistError);

					let errorMessage = "Error loading playlist. ";
					if (playlistError.statusCode === 403) {
						errorMessage += "YouTube is temporarily blocking requests. Please try again in a few minutes.";
					} else if (playlistError.message.includes('private') || playlistError.message.includes('unavailable')) {
						errorMessage += "This playlist might be private or unavailable.";
					} else {
						errorMessage += "Make sure the URL is a valid YouTube playlist.";
					}

					await interaction.editReply(errorMessage);
				}
			}
		} catch (error) {
			console.error('Error processing command:', error);
			await interaction.editReply("An error occurred while processing your request.");
		}
	}
});

client.login(process.env.TOKEN);