import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { activeSessions, broadcastToDiscord, saveSessions } from './bot.js';
import { Race } from './game/Race.js';
import { getUser, updateUserStats, getLeaderboard, updateUsername, purchaseAbility, consumeAbility } from './db/database.js';

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

const activeRaces = new Map<string, Race>();

// Get state endpoint for initial load
app.get('/api/session/:id', async (req, res) => {
    const sessionId = req.params.id;
    const userId = req.query.user as string;
    const isLocalMode = !process.env.DISCORD_TOKEN && !process.env.DISCORD_CLIENT_ID;

    if (!activeSessions.has(sessionId)) {
        if (isLocalMode) {
            activeSessions.set(sessionId, {
                authorId: 'test',
                channelId: 'test',
                status: 'waiting',
                loopActive: false
            });
            console.log(`Created fallback local session: ${sessionId}`);
        } else {
            // Create session on-demand for production
            activeSessions.set(sessionId, {
                authorId: userId,
                channelId: 'discord',
                status: 'waiting',
                loopActive: false
            });
            saveSessions();
            console.log(`Created on-demand session: ${sessionId} for user: ${userId}`);
        }
    }

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

app.post('/api/shop/buy', (req, res) => {
    const { userId, ability } = req.body as { userId: string; ability: 'nitro' | 'risk' | 'shield' | 'collide' };
    if (!userId || !ability) {
        return res.status(400).json({ success: false, message: 'Missing userId or ability.' });
    }
    const result = purchaseAbility(userId, ability);
    if (!result.success) {
        return res.status(400).json(result);
    }
    return res.json(result);
});

io.on('connection', (socket) => {
    const sessionId = socket.handshake.query.session as string;
    const userId = socket.handshake.query.user as string;

    if (!sessionId || !userId) {
        socket.disconnect();
        return;
    }

    socket.join(sessionId);

    socket.on('join_race', (data: { username: string }) => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'waiting') {
            updateUsername(userId, data.username);
            const added = race.addPlayer(userId, data.username);
            if (added) {
                io.to(sessionId).emit('race_updated', race);
            } else {
                socket.emit('error_message', 'Race is full of players!');
            }
        }
    });

    socket.on('place_bet', (data: { amount: number, carId: string, bettorName?: string }) => {
        const race = activeRaces.get(sessionId);
        if (race && race.status !== 'finished') {
            const user = getUser(userId);
            if ((user as any).balance >= data.amount) {
                updateUserStats(userId, -data.amount, false); // deduct
                race.placeBet(userId, data.amount, data.carId, data.bettorName);
                io.to(sessionId).emit('race_updated', race);
                socket.emit('user_updated', getUser(userId));
            } else {
                socket.emit('error_message', 'Insufficient balance');
            }
        }
    });

    socket.on('start_race', () => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'waiting') {
            race.start();
            io.to(sessionId).emit('race_updated', race);
            setTimeout(() => {
                const currentRace = activeRaces.get(sessionId);
                if (currentRace === race) {
                    io.to(sessionId).emit('race_updated', race);
                }
            }, 5200);
        }
    });

    socket.on('use_ability', (payload: any) => {
        const race = activeRaces.get(sessionId);
        if (race && race.status === 'active') {
            const ability = typeof payload === 'string' ? payload : payload?.ability;
            const targetId = typeof payload === 'object' ? payload?.targetId : undefined;
            if (!ability) return;

            const user = getUser(userId);
            if (!user.abilities[ability as keyof typeof user.abilities] || user.abilities[ability as keyof typeof user.abilities] <= 0) {
                socket.emit('error_message', 'You need to buy this ability in the shop before using it.');
                return;
            }

            const result = race.useAbility(userId, ability, targetId);
            if (result) {
                if (!result.success) {
                    socket.emit('error_message', result.message);
                } else {
                    const consumeResult = consumeAbility(userId, ability as 'nitro' | 'risk' | 'shield' | 'collide');
                    if (!consumeResult.success) {
                        socket.emit('error_message', consumeResult.message);
                        return;
                    }
                    io.to(sessionId).emit('race_updated', race);
                    socket.emit('ability_feedback', result.message);
                    socket.emit('user_updated', consumeResult.user);
                }
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
                 
                 // Calculate bet winners
                 const betWinners: Array<{ name: string, amount: number, payout: number }> = [];
                 
                 if (winner) {
                     // Payout logic: split the losers' pool among winning bettors proportionally
                     const allBets = Object.values(race.bettingPool).flat();
                     const totalPool = allBets.reduce((sum, bet) => sum + bet.amount, 0);
                     const winnersBets = race.bettingPool[winner.id] || [];
                     const winningTotal = winnersBets.reduce((sum, bet) => sum + bet.amount, 0);
                     const losingPool = Math.max(0, totalPool - winningTotal);

                     for (const bet of winnersBets) {
                         const share = winningTotal > 0 ? Math.round((bet.amount / winningTotal) * losingPool) : 0;
                         const payout = bet.amount + share;
                         updateUserStats(bet.userId, payout, true);
                         
                         const bettorName = race.bettorNames[bet.userId] || `Bettor ${bet.userId.substring(0, 4)}`;
                         betWinners.push({ name: bettorName, amount: bet.amount, payout });
                     }

                     // Payout to winning racer if it's a player
                     if (winner.ownerId) {
                         updateUserStats(winner.ownerId, 500, true);
                     }
                 }
                 
                 const sessionMeta = activeSessions.get(sessionId);
                 if (sessionMeta && sessionMeta.channelId) {
                     const betWinnersText = betWinners.length > 0 
                         ? `\n💰 **Bet Winners:** ${betWinners.map(b => `${b.name} (won ${b.payout})`).join(', ')}`
                         : '';
                     broadcastToDiscord(sessionMeta.channelId, `🏁 **Race Finished!** 🏁\nWinner: ${winner?.name}!${betWinnersText}`);
                 }
                 
                 // Send bet winners to all clients
                 io.to(sessionId).emit('bet_winners', betWinners);
                 
                 const shouldContinue = sessionMeta?.loopActive === true;
                 if (shouldContinue) {
                     const newRace = new Race(sessionId);
                     activeRaces.set(sessionId, newRace);
                     io.to(sessionId).emit('next_race', newRace);
                     io.to(sessionId).emit('race_updated', newRace);
                 } else {
                     activeRaces.delete(sessionId);
                     activeSessions.delete(sessionId);
                     saveSessions();
                 }
             }
        }
    }
}, 100);
