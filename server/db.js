/* ===== Life OS — SQLite persistence layer ===== */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.LIFEOS_DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "lifeos.db"));
db.pragma("journal_mode = WAL");

// Single-document store: the whole dashboard state lives as one JSON blob.
// Simple, reliable, and perfect for a single-user personal app.
db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    json       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function getState() {
  const row = db.prepare("SELECT json FROM state WHERE id = 1").get();
  return row ? JSON.parse(row.json) : null;
}

function saveState(stateObj) {
  const json = JSON.stringify(stateObj);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO state (id, json, updated_at) VALUES (1, @json, @now)
    ON CONFLICT(id) DO UPDATE SET json = @json, updated_at = @now
  `).run({ json, now });
  return { ok: true, updated_at: now };
}

function clearState() {
  db.prepare("DELETE FROM state WHERE id = 1").run();
}

module.exports = { getState, saveState, clearState, DATA_DIR };
