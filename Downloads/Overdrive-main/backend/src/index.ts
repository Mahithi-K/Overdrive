import dotenv from 'dotenv';
dotenv.config();

import { initBot } from './bot.js';
import { initDB } from './db/database.js';
import { server } from './server.js';
import { activeSessions } from './bot.js';

function getEnv(name: string) {
    return process.env[name]?.trim() ?? '';
}

async function bootstrap() {
    initDB();
    console.log('Database initialized');

    const token = getEnv('DISCORD_TOKEN');
    const clientId = getEnv('DISCORD_CLIENT_ID');
    const guildId = getEnv('DISCORD_GUILD_ID');
    const webUrl = getEnv('WEB_URL') || 'http://localhost:5175';
    const isLocalMode = !token && !clientId;

    if (token && !clientId) {
        console.warn('DISCORD_CLIENT_ID is missing. Slash command registration will be skipped, but prefix commands can still work after login.');
    }

    if (token) {
        try {
            await initBot(token, clientId, webUrl, guildId);
        } catch (err) {
            console.error('Discord bot failed to initialize:', err);
            if (isLocalMode) {
                console.warn('Falling back to local test session.');
                activeSessions.set('test-session', { authorId: 'test', channelId: 'test', status: 'waiting' });
            }
        }
    }

    if (isLocalMode) {
        console.warn('Discord is not configured. Running in local mode only.');
        activeSessions.set('test-session', { authorId: 'test', channelId: 'test', status: 'waiting' });
    }

    const port = process.env.PORT || 3001;
    server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use. Make sure no other backend instance is running and then retry.`);
            process.exit(1);
        }
        throw err;
    });

    server.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}

bootstrap();
