import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, TextChannel, Message } from 'discord.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLeaderboard, getUser } from './db/database.js';

let client: Client | null = null;

// Session persistence file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sessionsPath = path.resolve(__dirname, '../sessions.json');

// Map of sessionId -> { authorId, channelId, status }
export const activeSessions = new Map<string, any>();

// Load sessions from disk on startup
function loadSessions() {
    if (fs.existsSync(sessionsPath)) {
        try {
            const raw = fs.readFileSync(sessionsPath, 'utf8');
            const parsed = JSON.parse(raw);
            for (const [key, value] of Object.entries(parsed)) {
                activeSessions.set(key, value);
            }
            syncLoopState();
            console.log(`Loaded ${activeSessions.size} sessions from disk`);
        } catch (err) {
            console.warn('Failed to load sessions from disk:', err);
        }
    }
}

// Save sessions to disk
export function saveSessions() {
    const obj: Record<string, any> = {};
    for (const [key, value] of activeSessions.entries()) {
        obj[key] = value;
    }
    fs.writeFileSync(sessionsPath, JSON.stringify(obj, null, 2), 'utf8');
}

// Flag to control whether continuous race loops should be active
export let gameLooping = false;
export let activeGameAuthorId: string | null = null;

function syncLoopState() {
    const activeLoop = Array.from(activeSessions.values()).find((session) => session.loopActive);
    gameLooping = Boolean(activeLoop);
    activeGameAuthorId = activeLoop?.authorId ?? null;
}

export async function initBot(token: string, clientId: string, webUrl: string, guildId?: string) {
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
    const enableMemberEvents = process.env.ENABLE_MEMBER_EVENTS === 'true';
    const enablePrefixCommands = process.env.ENABLE_PREFIX_COMMANDS === 'true';

    if (enableMemberEvents) {
        intents.push(GatewayIntentBits.GuildMembers);
    }

    if (enablePrefixCommands) {
        intents.push(GatewayIntentBits.MessageContent);
    }

    client = new Client({ intents });
    const discordClient = client;

    const commands = [
        new SlashCommandBuilder()
            .setName('race')
            .setDescription('Start a new interactive street race session or get race details.')
            .addStringOption(option =>
                option.setName('action')
                    .setDescription('Use "help" to get race instructions instead of starting a race')
                    .setRequired(false)
                    .addChoices({ name: 'help', value: 'help' })
            ),
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
            const route = guildId
                ? Routes.applicationGuildCommands(clientId, guildId)
                : Routes.applicationCommands(clientId);
            await rest.put(
                route,
                { body: commands },
            );
            if (guildId) {
                console.log(`Successfully reloaded application (/) commands for guild ${guildId}.`);
            } else {
                console.log('Successfully reloaded global application (/) commands.');
            }
        } catch (error) {
            console.error('Failed to register slash commands:', error);
        }
    } else {
        console.warn('DISCORD_CLIENT_ID not set; slash commands will not be registered. Prefix commands still work.');
    }

    discordClient.on('ready', () => {
        console.log(`Logged in as ${discordClient.user?.tag}!`);
        if (!enablePrefixCommands) {
            console.log('Prefix commands are disabled. Set ENABLE_PREFIX_COMMANDS=true in backend/.env if you want !commands and have Message Content intent enabled in Discord.');
        }
        if (!enableMemberEvents) {
            console.log('Member welcome events are disabled. Set ENABLE_MEMBER_EVENTS=true in backend/.env if you want welcome messages and have Server Members intent enabled in Discord.');
        }
        loadSessions();
    });

    discordClient.on('guildCreate', guild => {
        const defaultChannel = guild.systemChannelId ? guild.systemChannelId : null;
        if (defaultChannel) {
            discordClient.channels.fetch(defaultChannel)
                .then(channel => {
                    if (channel?.isTextBased()) {
                        const textChannel = channel as TextChannel;
                        textChannel.send('👋 Neon Race Bot has arrived! Type /help or use !help to get started.');
                    }
                })
                .catch(() => undefined);
        }
    });

    if (enableMemberEvents) {
        discordClient.on('guildMemberAdd', member => {
            const defaultChannel = member.guild.systemChannel;
            if (!defaultChannel || !defaultChannel.isTextBased()) return;
            defaultChannel.send(`🎉 Welcome ${member.user.username} to ${member.guild.name}!` +
                `
Use /race to start a new game, /help to see commands, or !race help for quick game details.`);
        });
    }

    discordClient.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const replyHelp = async () => {
            await interaction.reply({
                content: '🏁 **Neon Race Bot Help**\n' +
                    '`/race` - Start a new street race session\n' +
                    '`/race action: help` - Show game details and race instructions\n' +
                    '`/stop` - Stop the active race loop\n' +
                    '`/ping` - Check bot latency\n' +
                    '`/leaderboard` - Show top server racers\n' +
                    '`/stats` - Show your race stats\n' +
                    '`/help` - Show this help message\n' +
                    '\n**Game overview:**\n' +
                    '• Start a race with `/race`. A race link is generated for your server.\n' +
                    '• Join as Racer, Bettor, or Viewer from the web page.\n' +
                    '• New users start with 1 of each ability and can buy more in the shop.\n' +
                    '• Use abilities during the race to gain an advantage or disrupt opponents.\n' +
                    '• The race ends when somebody reaches the finish line or after 3 minutes.\n' +
                    '\nUse `!race help` for the same help via text commands.',
                ephemeral: true
            });
        };

        if (interaction.commandName === 'race') {
            const action = interaction.options.getString('action');
            if (action === 'help') {
                await replyHelp();
                return;
            }

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
            saveSessions();

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
            syncLoopState();
            saveSessions();
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

    if (enablePrefixCommands) {
        discordClient.on('messageCreate', async (message: Message) => {
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
                if (args[0] && args[0].toLowerCase() === 'help') {
                    await message.reply('🏁 **Neon Race Bot Help**\n' +
                        '!race - Start a new street race session\n' +
                        '!race help - Show game instructions\n' +
                        '!stop - Stop the active race loop\n' +
                        '!ping - Check bot latency\n' +
                        '!leaderboard - Show top server racers\n' +
                        '!stats - Show your race stats\n' +
                        '\n**Game overview:** New users start with 1 of each ability and can buy more in the web shop. Use abilities during the race to gain an edge or slow opponents. The race ends when someone wins or after 3 minutes.');
                    return;
                }
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
                saveSessions();
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
                syncLoopState();
                saveSessions();
                await message.reply('🛑 **Race loop stopped.** Ongoing races will finish, but no new ones will start.');
            }
        });
    }

    await discordClient.login(token);
}

export async function broadcastToDiscord(channelId: string, message: string) {
    if (!client) {
        return;
    }
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel && channel.isTextBased()) {
        const textChannel = channel as TextChannel;
        await textChannel.send(message);
    }
}
