import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

type AbilityInventory = {
    nitro: number;
    risk: number;
    shield: number;
    collide: number;
};

type User = {
    id: string;
    username: string | null;
    balance: number;
    wins: number;
    total_earnings: number;
    abilities: AbilityInventory;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../../database.json');
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
        users[id] = {
            id,
            username: null,
            balance: 1000,
            wins: 0,
            total_earnings: 0,
            abilities: {
                nitro: 1,
                risk: 1,
                shield: 1,
                collide: 1
            }
        };
        saveUsers();
    }

    const user = users[id]!;
    if (!user.abilities) {
        user.abilities = { nitro: 1, risk: 1, shield: 1, collide: 1 };
        saveUsers();
    } else {
        let updated = false;
        const defaultAbilities: AbilityInventory = { nitro: 1, risk: 1, shield: 1, collide: 1 };
        for (const ability of Object.keys(defaultAbilities) as Array<keyof AbilityInventory>) {
            if (user.abilities[ability] === undefined || user.abilities[ability] === null) {
                user.abilities[ability] = defaultAbilities[ability];
                updated = true;
            }
        }
        if (updated) saveUsers();
    }

    return user;
}

export function purchaseAbility(id: string, ability: keyof AbilityInventory) {
    loadUsers();
    const user = ensureUser(id);
    const cost = 200;
    if (user.balance < cost) {
        return { success: false, message: 'Insufficient funds to purchase this ability.' };
    }
    user.balance -= cost;
    user.abilities[ability] = (user.abilities[ability] || 0) + 1;
    saveUsers();
    return { success: true, user };
}

export function consumeAbility(id: string, ability: keyof AbilityInventory) {
    loadUsers();
    const user = ensureUser(id);
    if (!user.abilities[ability] || user.abilities[ability] <= 0) {
        return { success: false, message: 'You do not own this ability.' };
    }
    user.abilities[ability]--;
    saveUsers();
    return { success: true, user };
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
