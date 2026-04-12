import fs from 'fs';
import path from 'path';

type User = {
    id: string;
    username: string | null;
    balance: number;
    wins: number;
    total_earnings: number;
};

const dbPath = path.join(process.cwd(), 'database.json');
const users: Record<string, User> = {};

function loadUsers() {
    if (!fs.existsSync(dbPath)) {
        return;
    }

    try {
        const raw = fs.readFileSync(dbPath, 'utf8');
        const parsed = JSON.parse(raw);
        for (const key of Object.keys(parsed)) {
            if (parsed[key]) {
                users[key] = parsed[key] as User;
            }
        }
    } catch {
        // Ignore invalid JSON and start fresh
    }
}

function saveUsers() {
    fs.writeFileSync(dbPath, JSON.stringify(users, null, 2), 'utf8');
}

function ensureUser(id: string): User {
    if (!users[id]) {
        users[id] = { id, username: null, balance: 1000, wins: 0, total_earnings: 0 };
        saveUsers();
    }
    return users[id]!;
}

export function initDB() {
    loadUsers();
}

export function getUser(id: string) {
    loadUsers();
    return ensureUser(id);
}

export function updateUsername(id: string, username: string) {
    loadUsers();
    const user = ensureUser(id);
    user.username = username;
    saveUsers();
}

export function updateUserStats(id: string, amount: number, isWin: boolean) {
    loadUsers();
    const user = ensureUser(id);
    user.balance += amount;
    if (isWin) {
        user.wins += 1;
    }
    user.total_earnings += amount > 0 ? amount : 0;
    saveUsers();
}

export function getLeaderboard() {
    loadUsers();
    return Object.values(users)
        .sort((a, b) => b.wins - a.wins || b.total_earnings - a.total_earnings)
        .slice(0, 10)
        .map((user) => ({
            id: user.id,
            username: user.username,
            balance: user.balance,
            wins: user.wins,
            total_earnings: user.total_earnings
        }));
}
