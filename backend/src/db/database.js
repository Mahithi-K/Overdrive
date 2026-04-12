import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);
export function initDB() {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 1000,
        wins INTEGER DEFAULT 0,
        total_earnings INTEGER DEFAULT 0
    )`);
}
export function getUser(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) {
        db.prepare('INSERT INTO users (id, balance) VALUES (?, 1000)').run(id);
        return { id, balance: 1000, wins: 0, total_earnings: 0 };
    }
    return row;
}
export function updateUserStats(id, amount, isWin) {
    const winIncrement = isWin ? 1 : 0;
    const earningsIncrement = amount > 0 ? amount : 0;
    db.prepare(`UPDATE users 
                SET balance = balance + ?, 
                    wins = wins + ?, 
                    total_earnings = total_earnings + ? 
                WHERE id = ?`).run(amount, winIncrement, earningsIncrement, id);
}
export function getLeaderboard() {
    return db.prepare('SELECT id, wins, total_earnings FROM users ORDER BY wins DESC LIMIT 10').all();
}
//# sourceMappingURL=database.js.map