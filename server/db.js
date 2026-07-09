/* ===== Life OS — SQLite persistence layer (multi-user) ===== */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.LIFEOS_DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "lifeos.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt          TEXT NOT NULL,
    hash          TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_state (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    json          TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
`);

/* ---- Password hashing (scrypt, no external deps) ---- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const cand = crypto.scryptSync(String(password), salt, 64).toString("hex");
  const a = Buffer.from(cand, "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---- Users ---- */
function createUser(username, password) {
  const { salt, hash } = hashPassword(password);
  const info = db.prepare(
    "INSERT INTO users (username, salt, hash, created_at) VALUES (?, ?, ?, ?)"
  ).run(username, salt, hash, new Date().toISOString());
  return { id: info.lastInsertRowid, username };
}
function getUserByName(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}
function userCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

/* ---- Per-user state ---- */
function getState(userId) {
  const row = db.prepare("SELECT json FROM user_state WHERE user_id = ?").get(userId);
  return row ? JSON.parse(row.json) : null;
}
function saveState(userId, stateObj) {
  const json = JSON.stringify(stateObj);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_state (user_id, json, updated_at) VALUES (@id, @json, @now)
    ON CONFLICT(user_id) DO UPDATE SET json = @json, updated_at = @now
  `).run({ id: userId, json, now });
  return { ok: true, updated_at: now };
}
function clearState(userId) {
  db.prepare("DELETE FROM user_state WHERE user_id = ?").run(userId);
}

module.exports = {
  DATA_DIR, hashPassword, verifyPassword,
  createUser, getUserByName, userCount,
  getState, saveState, clearState,
};
