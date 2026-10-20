import 'dotenv/config';
import { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, demuxProbe, joinVoiceChannel } from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { SettingsStore } from './settings.js';
import { PlaybackSession } from './playback.js';
import { fetchPlaylist, fetchRecommendations, isYouTubeUrl, videoId, ytAudioStream } from './youtube.js';

const settings = new SettingsStore('./data/settings.json', { autoplay: false });
const commands = [
	new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),
	new SlashCommandBuilder().setName('config').setDescription('Show or change saved settings for this server')
		.addBooleanOption(option => option.setName('autoplay').setDescription('Continue with YouTube recommendations after the queue ends')),
	...['play', 'loop', 'playlist'].map(name => new SlashCommandBuilder().setName(name)
		.setDescription({ play: 'Play a YouTube video', loop: 'Loop a YouTube video', playlist: 'Play a shuffled YouTube playlist' }[name])
		.addStringOption(option => option.setName('url').setDescription('YouTube URL').setRequired(true))),
];

const rest = new REST().setToken(process.env.TOKEN);
const configCommand = commands.find(command => command.name === 'config').toJSON();
// Configuration belongs to a server. Guild registration also makes changes visible immediately.
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.filter(command => command.name !== 'config') });

async function registerServerConfig(guild) {
	try {
		await rest.post(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id), { body: configCommand });
		console.log(`Registered /config in ${guild.name}`);
	} catch (error) {
		console.error(`Could not register /config in ${guild.name}:`, error);
	}
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
process.on('unhandledRejection', error => console.error('Unhandled promise rejection:', error));
for (const event of [Events.ShardError, Events.Error, Events.Warn]) client.on(event, console.error);
client.on(Events.ClientReady, () => {
	console.log(`Logged in as ${client.user.tag}!`);
	for (const guild of client.guilds.cache.values()) void registerServerConfig(guild);
});
client.on(Events.GuildCreate, registerServerConfig);

const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
let voiceConnection = null;
let activeGuildId = null;
let activeChannelId = null;
let controlMessage = null;
let currentContent = '';
let idleTimer = null;
let commandVersion = 0;
let audioStream = null;
let lastAction = '';
const IDLE_TIMEOUT_MS = (Number(process.env.IDLE_TIMEOUT_MINUTES) || 5) * 60_000;

const session = new PlaybackSession({ play: playYt, recommend: fetchRecommendations, update: updateControls });

function controls(disabled = false) {
	return new ActionRowBuilder().addComponents(
		...[
			['skip', '⏭️ Skip', ButtonStyle.Primary], ['pause', '⏸️ Pause', ButtonStyle.Secondary],
			['resume', '▶️ Resume', ButtonStyle.Success], ['stop', '⏹️ Stop', ButtonStyle.Danger],
			['shuffle', '🔀 Shuffle', ButtonStyle.Secondary],
		].map(([id, label, style]) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled)));
}

async function updateControls(content) {
	currentContent = content;
	if (!controlMessage) return;
	try {
		const action = lastAction ? `\n🔧 ${lastAction}` : '';
		await controlMessage.edit({ content: `${content}\n\n📻 Autoplay: **${session.autoplay ? 'on' : 'off'}**${action}`, components: [controls()], allowedMentions: { parse: [] } });
	} catch (error) { console.error('Could not update controls:', error); }
}

function startIdleTimer() {
	if (idleTimer || !voiceConnection) return;
	idleTimer = setTimeout(() => disconnect('💤 Disconnected due to inactivity.'), IDLE_TIMEOUT_MS);
}

function stopAudio() {
	player.stop();
	audioStream?.destroy();
	audioStream = null;
}

async function disconnect(message) {
	commandVersion++;
	session.reset();
	clearTimeout(idleTimer);
	idleTimer = null;
	const connection = voiceConnection;
	voiceConnection = null;
	if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
	activeGuildId = activeChannelId = null;
	stopAudio();
	const oldMessage = controlMessage;
	controlMessage = null;
	if (oldMessage) await oldMessage.edit({ content: message, components: [controls(true)] }).catch(console.error);
}

player.on('error', error => console.error('AudioPlayerError:', error));
player.on('stateChange', (_, state) => {
	if (state.status === AudioPlayerStatus.Playing) {
		clearTimeout(idleTimer);
		idleTimer = null;
	} else startIdleTimer();
	if (state.status === AudioPlayerStatus.Idle) session.onIdle();
});

async function playYt(url, stillCurrent) {
	for (let attempt = 0; attempt < 3 && stillCurrent(); attempt++) {
		let stream;
		try {
			stream = await ytAudioStream(url);
			if (!stillCurrent()) { stream.destroy(); return false; }
			const { stream: probed, type } = await demuxProbe(stream);
			if (!stillCurrent()) { stream.destroy(); return false; }
			audioStream?.destroy();
			audioStream = stream;
			player.play(createAudioResource(probed, { inputType: type }));
			return true;
		} catch (error) {
			stream?.destroy();
			console.error(`Error playing ${url}:`, error.message);
			if (/Only YouTube links|Video unavailable|Private video|Unsupported URL|removed|confirm your age/i.test(error.message)) break;
			if (attempt < 2 && stillCurrent()) await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
		}
	}
	return false;
}

function shuffle(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
}

async function handleInteraction(interaction) {
	if (interaction.isButton()) {
		if (interaction.message.id !== controlMessage?.id || interaction.guildId !== activeGuildId || interaction.member?.voice?.channelId !== activeChannelId) {
			await interaction.reply({ content: 'Join the active voice channel and use the current control panel.', flags: MessageFlags.Ephemeral });
			return;
		}
		await interaction.deferUpdate();
		lastAction = `${interaction.customId} by ${interaction.user.displayName || interaction.user.username}`;
		switch (interaction.customId) {
			case 'skip':
				if (session.advancing) return;
				if (!player.stop()) await session.advance();
				break;
			case 'pause':
				player.pause();
				await updateControls(`⏸️ Paused: ${session.current?.title || 'playback'}`);
				break;
			case 'resume':
				player.unpause();
				await updateControls(`▶️ Resumed: ${session.current?.title || 'playback'}`);
				break;
			case 'stop': await disconnect('⏹️ Playback stopped.'); break;
			case 'shuffle':
				session.queue = [...session.queue.slice(0, session.index), ...shuffle(session.queue.slice(session.index))];
				await updateControls(`${currentContent}\n🔀 Shuffled remaining tracks.`);
				break;
		}
		return;
	}
	if (!interaction.isChatInputCommand()) return;
	if (interaction.commandName === 'ping') { await interaction.reply('Pong!'); return; }
	if (!interaction.guildId) {
		await interaction.reply({ content: 'Use this command in a server.', flags: MessageFlags.Ephemeral });
		return;
	}
	if (interaction.commandName === 'config') {
		const autoplay = interaction.options.getBoolean('autoplay');
		const saved = autoplay === null ? settings.get(interaction.guildId) : settings.update(interaction.guildId, { autoplay });
		await interaction.reply({ content: `Autoplay: **${saved.autoplay ? 'on' : 'off'}** (saved for this server). YouTube recommendations play after the queue ends; loops keep repeating.`, flags: MessageFlags.Ephemeral });
		if (activeGuildId === interaction.guildId) {
			session.autoplay = saved.autoplay;
			await updateControls(currentContent);
			if (saved.autoplay && player.state.status === AudioPlayerStatus.Idle) void session.advance();
		}
		return;
	}
	if (!['play', 'loop', 'playlist'].includes(interaction.commandName)) return;
	const channelId = interaction.member?.voice?.channelId;
	if (!channelId || (voiceConnection && (activeGuildId !== interaction.guildId || activeChannelId !== channelId))) {
		await interaction.reply({ content: voiceConnection ? 'Join the active voice channel to change playback.' : 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
		return;
	}
	const url = interaction.options.getString('url');
	if (!isYouTubeUrl(url) || (interaction.commandName !== 'playlist' && !videoId(url))) {
		await interaction.reply({ content: 'Use a YouTube video link, or /playlist for a playlist link.', flags: MessageFlags.Ephemeral });
		return;
	}
	await interaction.deferReply();
	// Another request may have joined a different channel while Discord acknowledged this one.
	if (voiceConnection && (activeGuildId !== interaction.guildId || activeChannelId !== channelId)) {
		await interaction.editReply('Join the active voice channel to change playback.');
		return;
	}
	const version = ++commandVersion;
	session.reset();
	stopAudio();
	if (!voiceConnection) {
		voiceConnection = joinVoiceChannel({ channelId, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
		voiceConnection.on('error', console.error);
		const connection = voiceConnection;
		voiceConnection.on(VoiceConnectionStatus.Destroyed, () => {
			if (voiceConnection === connection) void disconnect('Disconnected from voice.');
		});
		voiceConnection.subscribe(player);
	}
	activeGuildId = interaction.guildId;
	activeChannelId = channelId;
	startIdleTimer();
	if (controlMessage) await controlMessage.edit({ components: [controls(true)] }).catch(console.error);
	if (version !== commandVersion) return;
	lastAction = '';
	const message = await interaction.editReply({ content: '⏳ Loading…', components: [controls()] });
	if (version !== commandVersion) {
		await message.edit({ content: 'Replaced by a newer playback request.', components: [controls(true)] }).catch(console.error);
		return;
	}
	controlMessage = message;
	const playlist = interaction.commandName === 'playlist' ? await fetchPlaylist(url)
		: { title: 'YouTube', items: [{ id: videoId(url), title: 'YouTube video', url: `https://www.youtube.com/watch?v=${videoId(url)}` }] };
	if (version !== commandVersion) return;
	if (!playlist.items.length) { await updateControls('No playable videos found.'); return; }
	await session.start({ tracks: interaction.commandName === 'playlist' ? shuffle(playlist.items) : playlist.items,
		title: playlist.title, loop: interaction.commandName === 'loop', autoplay: settings.get(interaction.guildId).autoplay });
}

client.on(Events.InteractionCreate, async interaction => {
	try { await handleInteraction(interaction); }
	catch (error) {
		console.error('Interaction error:', error);
		const response = { content: '❌ Could not complete that request. Check the YouTube link and try again.' };
		if (interaction.deferred || interaction.replied) await interaction.editReply(response).catch(console.error);
		else await interaction.reply({ ...response, flags: MessageFlags.Ephemeral }).catch(console.error);
	}
});

client.login(process.env.TOKEN);
