/* ===== Life OS — Express backend (multi-user) =====
 * Serves the static frontend and a REST API backed by SQLite. Every user has
 * their own account (hashed password) and their own private dashboard state.
 *
 *   GET    /api/health                 -> { ok, users }
 *   POST   /api/register               -> { token, username }   (body: {username,password})
 *   POST   /api/login                  -> { token, username }   (body: {username,password})
 *   GET    /api/me                     -> { username }           (auth)
 *   GET    /api/state                  -> user's state (204 if none)   (auth)
 *   PUT    /api/state                  -> save user's state             (auth)
 *   DELETE /api/state                  -> wipe user's state             (auth)
 *   POST   /api/collection/:name       -> create item     (auth)
 *   PUT    /api/collection/:name/:id   -> modify item     (auth)
 *   DELETE /api/collection/:name/:id   -> delete item     (auth)
 *   POST   /api/sync/calendar          -> Google Calendar (ICS) sync    (auth)
 */
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const { parseICS } = require("./ics");

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== "false";

app.use(express.json({ limit: "5mb" }));

// In-memory token -> userId map (cleared on restart; users just log in again).
const tokens = new Map();
function issueToken(userId) {
  const t = crypto.randomBytes(24).toString("hex");
  tokens.set(t, userId);
  return t;
}
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const userId = tokens.get(token);
  if (!userId) return res.status(401).json({ error: "Unauthorized — please log in." });
  req.userId = userId;
  next();
}

const validName = u => typeof u === "string" && /^[a-zA-Z0-9_.-]{3,32}$/.test(u);

// ---- Auth ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, users: db.userCount(), registrationOpen: ALLOW_REGISTRATION });
});

app.post("/api/register", (req, res) => {
  if (!ALLOW_REGISTRATION) return res.status(403).json({ error: "Registration is disabled." });
  const { username, password } = req.body || {};
  if (!validName(username)) return res.status(400).json({ error: "Username must be 3–32 chars (letters, numbers, . _ -)." });
  if (typeof password !== "string" || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  if (db.getUserByName(username)) return res.status(409).json({ error: "That username is taken." });
  const user = db.createUser(username, password);
  res.status(201).json({ token: issueToken(user.id), username: user.username });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.getUserByName(String(username || ""));
  if (!user || !db.verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  res.json({ token: issueToken(user.id), username: user.username });
});

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ userId: req.userId });
});

// ---- Per-user state ----
app.get("/api/state", requireAuth, (req, res) => {
  const state = db.getState(req.userId);
  if (!state) return res.status(204).end();
  res.json(state);
});

app.put("/api/state", requireAuth, (req, res) => {
  if (!req.body || typeof req.body !== "object") return res.status(400).json({ error: "Invalid state payload." });
  res.json(db.saveState(req.userId, req.body));
});

app.delete("/api/state", requireAuth, (req, res) => {
  db.clearState(req.userId);
  res.json({ ok: true });
});

/* ---- Granular per-collection CRUD (per-user) ---- */
const COLLECTIONS = {
  habits: s => s.habits,
  tasks: s => s.tasks,
  events: s => s.events,
  notes: s => s.notes,
  goals: s => s.goals,
  budgets: s => s.finance && s.finance.budgets,
  metrics: s => s.health && s.health.metrics,
};
function resolveCollection(req, res, name) {
  const state = db.getState(req.userId);
  if (!state) { res.status(409).json({ error: "No state yet — save the dashboard first." }); return null; }
  const getter = COLLECTIONS[name];
  if (!getter) { res.status(404).json({ error: "Unknown collection: " + name }); return null; }
  const arr = getter(state);
  if (!Array.isArray(arr)) { res.status(500).json({ error: "Collection not initialized: " + name }); return null; }
  return { state, arr };
}

app.post("/api/collection/:name", requireAuth, (req, res) => {
  const ctx = resolveCollection(req, res, req.params.name); if (!ctx) return;
  const item = Object.assign({}, req.body);
  if (!item.id) item.id = "id" + crypto.randomBytes(5).toString("hex");
  ctx.arr.push(item);
  db.saveState(req.userId, ctx.state);
  res.status(201).json(item);
});

app.put("/api/collection/:name/:id", requireAuth, (req, res) => {
  const ctx = resolveCollection(req, res, req.params.name); if (!ctx) return;
  const item = ctx.arr.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found: " + req.params.id });
  Object.assign(item, req.body, { id: item.id });
  db.saveState(req.userId, ctx.state);
  res.json(item);
});

app.delete("/api/collection/:name/:id", requireAuth, (req, res) => {
  const ctx = resolveCollection(req, res, req.params.name); if (!ctx) return;
  const idx = ctx.arr.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found: " + req.params.id });
  const [removed] = ctx.arr.splice(idx, 1);
  db.saveState(req.userId, ctx.state);
  res.json({ ok: true, removed });
});

/* ---- Google Calendar (ICS) sync (per-user) ---- */
app.post("/api/sync/calendar", requireAuth, async (req, res) => {
  const state = db.getState(req.userId);
  if (!state) return res.status(409).json({ error: "No state yet — save the dashboard first." });
  const url = (req.body && req.body.url) || (state.settings && state.settings.icsUrl);
  if (!url) return res.status(400).json({ error: "No calendar URL set. Add your private iCal URL in Admin." });
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return res.status(502).json({ error: "Calendar fetch failed (HTTP " + r.status + ")." });
    const text = await r.text();
    const parsed = parseICS(text);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    const fresh = parsed.filter(e => e.date >= cutoffISO);
    if (!Array.isArray(state.events)) state.events = [];
    const manual = state.events.filter(e => e.source !== "ics");
    state.events = manual.concat(fresh);
    if (state.settings) { state.settings.icsUrl = url; state.settings.lastCalendarSync = new Date().toISOString(); }
    db.saveState(req.userId, state);
    res.json({ ok: true, imported: fresh.length, total: state.events.length });
  } catch (e) {
    res.status(502).json({ error: "Could not reach calendar URL: " + e.message });
  }
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`\n  ⚡ Life OS running at http://localhost:${PORT}`);
  console.log(`  Multi-user: registration is ${ALLOW_REGISTRATION ? "OPEN" : "DISABLED"} · ${db.userCount()} user(s)`);
  console.log(`  Database: ${db.DATA_DIR}\n`);
});
