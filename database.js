const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./users.db");

// Create users table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            avatar TEXT,
            created_at INTEGER
        )
    `);
});

module.exports = db;