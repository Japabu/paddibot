import 'dotenv/config';

import { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, demuxProbe, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
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

async function playNextInPlaylist() {
	if (currentPlaylistIndex < currentPlaylist.length) {
		const video = currentPlaylist[currentPlaylistIndex];
		console.log(`Playing: ${video.title} (${currentPlaylistIndex + 1}/${currentPlaylist.length})`);
		await playYt(video.url);
		currentPlaylistIndex++;
	}
}

async function probeAndCreateResource(readableStream) {
	const { stream, type } = await demuxProbe(readableStream);
	return createAudioResource(stream, { inputType: type });
}

function ytAudioStream(url) {
	return ytdl(url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
}


async function playYt(url) {
	const yt = ytAudioStream(url);
	const res = await probeAndCreateResource(yt);
	player.play(res);
}

client.on(Events.InteractionCreate, async interaction => {
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
				await playYt(url);
				await interaction.editReply("Playing: " + url);
			} else if (interaction.commandName === "loop") {
				loopUrl = url;
				currentPlaylist = [];
				currentPlaylistIndex = 0;
				await playYt(url);
				await interaction.editReply("Looping: " + url);
			} else if (interaction.commandName === "playlist") {
				loopUrl = null;

				try {
					await interaction.editReply("Loading playlist...");

					const playlist = await ytpl(url);
					const videos = playlist.items.filter(item => item.url && !item.isLive);

					if (videos.length === 0) {
						await interaction.editReply("No playable videos found in this playlist.");
						return;
					}

					// Shuffle the playlist
					currentPlaylist = shuffleArray(videos);
					currentPlaylistIndex = 0;

					await interaction.editReply(`Loaded and shuffled playlist: **${playlist.title}** (${videos.length} videos)`);

					// Start playing the first video
					await playNextInPlaylist();

				} catch (playlistError) {
					console.error('Error loading playlist:', playlistError);
					await interaction.editReply("Error loading playlist. Make sure the URL is a valid YouTube playlist.");
				}
			}
		} catch (error) {
			console.error('Error processing command:', error);
			await interaction.editReply("An error occurred while processing your request.");
		}
	}
});

client.login(process.env.TOKEN);