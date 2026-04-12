import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, TextChannel, Message } from 'discord.js';
import crypto from 'crypto';
import { getLeaderboard, getUser } from './db/database.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Map of sessionId -> { authorId, channelId, status }
export const activeSessions = new Map<string, any>();

// Flag to control whether continuous race loops should be active
export let gameLooping = false;
export let activeGameAuthorId: string | null = null;

export async function initBot(token: string, clientId: string, webUrl: string) {
    const commands = [
        new SlashCommandBuilder()
            .setName('race')
            .setDescription('Start a new interactive street race session!'),
        new SlashCommandBuilder()
            .setName('stop')
            .setDescription('Stop the current race session loop'),
        new SlashCommandBuilder()
            .setName('ping')
            .setDescription('Check bot latency'),
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Show the top racers and bettors'),
        new SlashCommandBuilder()
            .setName('stats')
            .setDescription('Show your current race stats'),
        new SlashCommandBuilder()
            .setName('help')
            .setDescription('Show available bot commands')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(token);

    if (clientId) {
        try {
            console.log('Started refreshing application (/) commands.');
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commands },
            );
            console.log('Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('Failed to register slash commands:', error);
        }
    } else {
        console.warn('DISCORD_CLIENT_ID not set; slash commands will not be registered. Prefix commands still work.');
    }

    client.on('ready', () => {
        console.log(`Logged in as ${client.user?.tag}!`);
    });

    client.on('guildCreate', guild => {
        const defaultChannel = guild.systemChannelId ? guild.systemChannelId : null;
        if (defaultChannel) {
            client.channels.fetch(defaultChannel)
                .then(channel => {
                    if (channel?.isTextBased()) {
                        const textChannel = channel as TextChannel;
                        textChannel.send('👋 Neon Race Bot has arrived! Type /help or use !help to get started.');
                    }
                })
                .catch(() => undefined);
        }
    });

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const replyHelp = async () => {
            await interaction.reply({
                content: '🏁 **Neon Race Bot Commands**\n' +
                    '`/race` - Start a new street race session\n' +
                    '`/stop` - Stop the active race loop\n' +
                    '`/ping` - Check bot latency\n' +
                    '`/leaderboard` - Show top server racers\n' +
                    '`/stats` - Show your race stats\n' +
                    '`/help` - Show this help message\n' +
                    '\nUse `!race`, `!stop`, `!ping`, `!leaderboard`, `!stats`, or `!help` as prefix commands too.',
                ephemeral: true
            });
        };

        if (interaction.commandName === 'race') {
            if (gameLooping) {
                await interaction.reply({
                    content: '🏎️ **A race loop is already running!** Use `/stop` to end it.',
                    ephemeral: true
                });
                return;
            }
            
            gameLooping = true;
            activeGameAuthorId = interaction.user.id;
            const sessionId = crypto.randomUUID();
            activeSessions.set(sessionId, {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                status: 'waiting',
                loopActive: true
            });

            const link = `${webUrl}?session=${sessionId}&user=${interaction.user.id}`;
            
            await interaction.reply({
                content: `🏎️ **A new street race loop is starting!**\n\nClick the link below to join as a Racer, Bettor, or Viewer:\n${link}\n\nThe race will restart automatically after each session. Use /stop to end.`,
                ephemeral: false
            });
        } else if (interaction.commandName === 'stop') {
            if (!gameLooping) {
                await interaction.reply({
                    content: '⛔ **No active race loop.**',
                    ephemeral: true
                });
                return;
            }
            gameLooping = false;
            for (const [sessionId, sessionMeta] of activeSessions.entries()) {
                if (sessionMeta.loopActive) {
                    sessionMeta.loopActive = false;
                    activeSessions.set(sessionId, sessionMeta);
                }
            }
            await interaction.reply({
                content: '🛑 **Race loop stopped.** Ongoing races will finish, but no new ones will start.',
                ephemeral: false
            });
        } else if (interaction.commandName === 'ping') {
            await interaction.reply({
                content: `🏓 Pong! Latency: ${Date.now() - interaction.createdTimestamp}ms`,
                ephemeral: true
            });
        } else if (interaction.commandName === 'leaderboard') {
            const rows = getLeaderboard() as Array<{ id: string; username?: string | null; wins: number; total_earnings: number }>;
            const message = rows.map((row, idx) => `**${idx + 1}.** ${row.username || row.id} — ${row.wins} wins, $${row.total_earnings}`).join('\n') || 'No leaderboard data yet.';
            await interaction.reply({
                content: `🏆 **Server Leaderboard**\n${message}`,
                ephemeral: false
            });
        } else if (interaction.commandName === 'stats') {
            const stats = getUser(interaction.user.id) as { username?: string | null; balance: number; wins: number; total_earnings: number };
            await interaction.reply({
                content: `📊 **Your Stats**\nUsername: ${stats.username || interaction.user.username}\nBalance: $${stats.balance}\nWins: ${stats.wins}\nTotal earnings: $${stats.total_earnings}`,
                ephemeral: true
            });
        } else if (interaction.commandName === 'help') {
            await replyHelp();
        }
    });

    client.on('messageCreate', async (message: Message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;
        const [command, ...args] = message.content.slice(1).trim().split(/\s+/);
        if (!command) return;
        const normalized = command.toLowerCase();

        if (normalized === 'ping') {
            await message.reply(`🏓 Pong! Latency: ${Date.now() - message.createdTimestamp}ms`);
        } else if (normalized === 'help') {
            await message.reply('🏁 **Neon Race Bot Commands**\n!race - Start a new street race session\n!stop - Stop the active race loop\n!ping - Check bot latency\n!leaderboard - Show top server racers\n!stats - Show your race stats\n!help - Show this help message');
        } else if (normalized === 'leaderboard') {
            const rows = getLeaderboard() as Array<{ id: string; username?: string | null; wins: number; total_earnings: number }>;
            const messageText = rows.map((row, idx) => `**${idx + 1}.** ${row.username || row.id} — ${row.wins} wins, $${row.total_earnings}`).join('\n') || 'No leaderboard data yet.';
            await message.reply(`🏆 **Server Leaderboard**\n${messageText}`);
        } else if (normalized === 'stats') {
            const stats = getUser(message.author.id) as { username?: string | null; balance: number; wins: number; total_earnings: number };
            await message.reply(`📊 **Your Stats**\nUsername: ${stats.username || message.author.username}\nBalance: $${stats.balance}\nWins: ${stats.wins}\nTotal earnings: $${stats.total_earnings}`);
        } else if (normalized === 'race') {
            if (gameLooping) {
                await message.reply('🏎️ **A race loop is already running!** Use !stop to end it.');
                return;
            }
            gameLooping = true;
            activeGameAuthorId = message.author.id;
            const sessionId = crypto.randomUUID();
            activeSessions.set(sessionId, {
                authorId: message.author.id,
                channelId: message.channel.id,
                status: 'waiting',
                loopActive: true
            });
            const link = `${webUrl}?session=${sessionId}&user=${message.author.id}`;
            await message.reply(`🏎️ **A new street race loop is starting!**\n${link}\nThe race will restart automatically after each session. Use !stop to end.`);
        } else if (normalized === 'stop') {
            if (!gameLooping) {
                await message.reply('⛔ **No active race loop.**');
                return;
            }
            gameLooping = false;
            for (const [sessionId, sessionMeta] of activeSessions.entries()) {
                if (sessionMeta.loopActive) {
                    sessionMeta.loopActive = false;
                    activeSessions.set(sessionId, sessionMeta);
                }
            }
            await message.reply('🛑 **Race loop stopped.** Ongoing races will finish, but no new ones will start.');
        }
    });

    await client.login(token);
}

export async function broadcastToDiscord(channelId: string, message: string) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
        const textChannel = channel as TextChannel;
        await textChannel.send(message);
    }
}
