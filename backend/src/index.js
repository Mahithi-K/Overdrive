import dotenv from 'dotenv';
dotenv.config();
import { initBot } from './bot.js';
import { initDB } from './db/database.js';
import { server } from './server.js';
async function bootstrap() {
    initDB();
    console.log('Database initialized');
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const webUrl = process.env.WEB_URL || 'http://localhost:5173';
    if (token && clientId) {
        await initBot(token, clientId, webUrl);
    }
    else {
        console.warn('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID, bot not initialized. Only web frontend will be reachable.');
        // If testing without discord, we can manually inject a session:
        // import { activeSessions } from './bot';
        // activeSessions.set('test-session', { authorId: 'test', channelId: 'test', status: 'waiting' });
    }
    const port = process.env.PORT || 3001;
    server.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}
bootstrap();
//# sourceMappingURL=index.js.map