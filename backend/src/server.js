import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { activeSessions, broadcastToDiscord } from './bot.js';
import { Race } from './game/Race.js';
import { getUser, updateUserStats, getLeaderboard } from './db/database.js';
export const app = express();
export const server = http.createServer(app);
export const io = new Server(server, {
    cors: {
        origin: '*', // For development
        methods: ['GET', 'POST']
    }
});
app.use(cors());
app.use(express.json());
const activeRaces = new Map();
// Get state endpoint for initial load
app.get('/api/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.query.user;
    if (!activeSessions.has(sessionId)) {
        return res.status(404).json({ error: 'Session not found' });
    }
    // Ensure race instance exists
    if (!activeRaces.has(sessionId)) {
        activeRaces.set(sessionId, new Race(sessionId));
    }
    const val = getUser(userId);
    res.json({ session: activeSessions.get(sessionId), race: activeRaces.get(sessionId), user: val });
});
// Leaderboard endpoint
app.get('/api/leaderboard', (req, res) => {
    const rows = getLeaderboard();
    res.json(rows);
});
io.on('connection', (socket) => {
    const sessionId = socket.handshake.query.session;
    const userId = socket.handshake.query.user;
    if (!sessionId || !userId) {
        socket.disconnect();
        return;
    }
    socket.join(sessionId);
    socket.on('join_race', (data) => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'waiting') {
            const added = race.addPlayer(userId, data.username);
            if (added) {
                io.to(sessionId).emit('race_updated', race);
            }
            else {
                socket.emit('error_message', 'Race is full of players!');
            }
        }
    });
    socket.on('place_bet', (data) => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'waiting') {
            const user = getUser(userId);
            if (user.balance >= data.amount) {
                updateUserStats(userId, -data.amount, false); // deduct
                race.placeBet(userId, data.amount, data.carId);
                io.to(sessionId).emit('race_updated', race);
                socket.emit('user_updated', getUser(userId));
            }
            else {
                socket.emit('error_message', 'Insufficient balance');
            }
        }
    });
    socket.on('start_race', () => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'waiting') {
            race.start();
            io.to(sessionId).emit('race_updated', race);
        }
    });
    socket.on('use_ability', (ability) => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'active') {
            const car = race.cars.find(c => c.ownerId === userId);
            if (car) {
                if (ability === 'nitro' && car.nitroBoostRemaining <= 0)
                    car.nitroBoostRemaining = 2000;
                else if (ability === 'shield' && car.shieldRemaining <= 0)
                    car.shieldRemaining = 3000;
                else if (ability === 'riskDrift')
                    car.riskDriftActive = true;
            }
        }
    });
});
// Game loop tick
setInterval(async () => {
    for (const [sessionId, race] of activeRaces.entries()) {
        if (race.status === 'active') {
            race.tick(100);
            io.to(sessionId).emit('race_state', { cars: race.cars });
            // @ts-ignore
            if (race.status === 'finished') {
                io.to(sessionId).emit('race_finished', race);
                const winner = race.getWinner();
                if (winner) {
                    // Payout logic
                    const winnersBets = race.bettingPool[winner.id] || [];
                    for (const bet of winnersBets) {
                        const odds = 2.0; // simple odds for now
                        const payout = bet.amount * odds;
                        updateUserStats(bet.userId, payout + bet.amount, true);
                    }
                    // Payout to winning racer if it's a player
                    if (winner.ownerId) {
                        updateUserStats(winner.ownerId, 500, true);
                    }
                }
                const sessionMeta = activeSessions.get(sessionId);
                if (sessionMeta && sessionMeta.channelId) {
                    broadcastToDiscord(sessionMeta.channelId, `🏁 **Race Finished!** 🏁\nWinner: ${winner?.name}!`);
                }
                // Cleanup
                activeRaces.delete(sessionId);
                activeSessions.delete(sessionId);
            }
        }
    }
}, 100);
//# sourceMappingURL=server.js.map