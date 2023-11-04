import 'dotenv/config';

import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { VoiceConnectionStatus, createAudioPlayer, createAudioResource, demuxProbe, joinVoiceChannel } from '@discordjs/voice';
import { ytAudioStream } from './yt.js';

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
];

const rest = new REST().setToken(process.env.TOKEN);
rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

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



const player = createAudioPlayer();

player.on('error', error => {
	console.error('AudioPlayerError:', error);
});

async function probeAndCreateResource(readableStream) {
	const { stream, type } = await demuxProbe(readableStream);
	return createAudioResource(stream, { inputType: type });
}


client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === "ping") {
		await interaction.reply("Pong!");
	} else if (interaction.commandName === "play") {
		const url = interaction.options.getString("url");
		console.log(url);

		const connection = joinVoiceChannel({
			channelId: interaction.member.voice.channel.id,
			guildId: interaction.guild.id,
			adapterCreator: interaction.guild.voiceAdapterCreator,
		});

		connection.on(VoiceConnectionStatus.Ready, () => {
			console.log('The connection has entered the Ready state - ready to play audio!');
		});

		const yt = ytAudioStream(url);
		const res = await probeAndCreateResource(yt);
		connection.subscribe(player);
		player.play(res);

		await interaction.reply("Playing: " + url);
	}
});

client.login(process.env.TOKEN);