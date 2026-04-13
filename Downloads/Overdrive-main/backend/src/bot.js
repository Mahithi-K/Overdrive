import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import crypto from 'crypto';
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});
// Map of sessionId -> { authorId, channelId, status }
export const activeSessions = new Map();
export async function initBot(token, clientId, webUrl) {
    const commands = [
        new SlashCommandBuilder()
            .setName('race')
            .setDescription('Start a new interactive street race session!')
    ].map(command => command.toJSON());
    const rest = new REST({ version: '10' }).setToken(token);
    try {
        console.log('Started refreshing application (/) commands.');
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Successfully reloaded application (/) commands.');
    }
    catch (error) {
        console.error(error);
    }
    client.on('ready', () => {
        console.log(`Logged in as ${client.user?.tag}!`);
    });
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand())
            return;
        if (interaction.commandName === 'race') {
            const sessionId = crypto.randomUUID();
            activeSessions.set(sessionId, {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                status: 'waiting' // waiting, active, finished
            });
            // Generate link
            const link = `${webUrl}?session=${sessionId}&user=${interaction.user.id}`;
            await interaction.reply({
                content: `🏎️ **A new street race is starting!**\n\nClick the link below to join as a Racer, Bettor, or Viewer:\n${link}`,
                ephemeral: false
            });
        }
    });
    await client.login(token);
}
export function broadcastToDiscord(channelId, message) {
    const channel = client.channels.cache.get(channelId);
    if (channel && channel.isTextBased()) {
        //@ts-ignore
        channel.send(message);
    }
}
//# sourceMappingURL=bot.js.map