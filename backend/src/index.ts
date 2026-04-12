import dotenv from 'dotenv';
dotenv.config();

import { initBot } from './bot.js';
import { initDB } from './db/database.js';
import { server } from './server.js';
import { activeSessions } from './bot.js';

async function bootstrap() {
    initDB();
    console.log('Database initialized');

    const token = process.env.DISCORD_TOKEN || '';
    const clientId = process.env.DISCORD_CLIENT_ID || '';
    const webUrl = process.env.WEB_URL || 'http://localhost:5175';
    const isLocalMode = !token && !clientId;

    if (token) {
        try {
            await initBot(token, clientId, webUrl);
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
