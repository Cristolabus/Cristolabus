/* ===== Life OS — Express backend =====
 * Serves the static frontend and a small REST API backed by SQLite.
 * Writes are protected by an admin token (password -> bearer token).
 *
 *   GET  /api/health           -> { ok, hasState }
 *   POST /api/login            -> { token }            (body: { password })
 *   GET  /api/state            -> full state JSON (or 204 if none yet)
 *   PUT  /api/state            -> save state   (auth required)
 *   DELETE /api/state          -> wipe state   (auth required)
 */
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const db = require("./db");
const { parseICS } = require("./ics");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

app.use(express.json({ limit: "5mb" }));

// In-memory set of valid session tokens (reset on restart).
const tokens = new Set();
function issueToken() {
  const t = crypto.randomBytes(24).toString("hex");
  tokens.add(t);
  return t;
}
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (tokens.has(token)) return next();
  res.status(401).json({ error: "Unauthorized — admin login required." });
}

// ---- API ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, hasState: db.getState() !== null });
});

app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong password." });
  }
  res.json({ token: issueToken() });
});

app.get("/api/state", (req, res) => {
  const state = db.getState();
  if (!state) return res.status(204).end();
  res.json(state);
});

app.put("/api/state", requireAuth, (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Invalid state payload." });
  }
  const result = db.saveState(req.body);
  res.json(result);
});

app.delete("/api/state", requireAuth, (req, res) => {
  db.clearState();
  res.json({ ok: true });
});

/* ---- Granular per-collection CRUD ----
 * Real create / modify / delete for each entity, operating on the stored
 * document. Useful for scripting, automation, and integrations.
 *   POST   /api/collection/:name        create (body = item; id auto if absent)
 *   PUT    /api/collection/:name/:id     modify (body = partial fields to merge)
 *   DELETE /api/collection/:name/:id     delete
 */
const COLLECTIONS = {
  habits: s => s.habits,
  tasks: s => s.tasks,
  events: s => s.events,
  notes: s => s.notes,
  goals: s => s.goals,
  budgets: s => s.finance && s.finance.budgets,
  metrics: s => s.health && s.health.metrics,
};
function resolveCollection(res, name) {
  const state = db.getState();
  if (!state) { res.status(409).json({ error: "No state yet — save the dashboard first." }); return null; }
  const getter = COLLECTIONS[name];
  if (!getter) { res.status(404).json({ error: "Unknown collection: " + name }); return null; }
  const arr = getter(state);
  if (!Array.isArray(arr)) { res.status(500).json({ error: "Collection not initialized: " + name }); return null; }
  return { state, arr };
}

app.post("/api/collection/:name", requireAuth, (req, res) => {
  const ctx = resolveCollection(res, req.params.name); if (!ctx) return;
  const item = Object.assign({}, req.body);
  if (!item.id) item.id = "id" + crypto.randomBytes(5).toString("hex");
  ctx.arr.push(item);
  db.saveState(ctx.state);
  res.status(201).json(item);
});

app.put("/api/collection/:name/:id", requireAuth, (req, res) => {
  const ctx = resolveCollection(res, req.params.name); if (!ctx) return;
  const item = ctx.arr.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found: " + req.params.id });
  Object.assign(item, req.body, { id: item.id });
  db.saveState(ctx.state);
  res.json(item);
});

app.delete("/api/collection/:name/:id", requireAuth, (req, res) => {
  const ctx = resolveCollection(res, req.params.name); if (!ctx) return;
  const idx = ctx.arr.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found: " + req.params.id });
  const [removed] = ctx.arr.splice(idx, 1);
  db.saveState(ctx.state);
  res.json({ ok: true, removed });
});

/* ---- Google Calendar (ICS) sync ----
 * Fetches the private iCal URL saved in settings.icsUrl, parses upcoming
 * events, and merges them in (replacing previously-synced ones, keeping
 * manually-added events). Body may override the URL for a one-off sync.
 */
app.post("/api/sync/calendar", requireAuth, async (req, res) => {
  const state = db.getState();
  if (!state) return res.status(409).json({ error: "No state yet — save the dashboard first." });
  const url = (req.body && req.body.url) || (state.settings && state.settings.icsUrl);
  if (!url) return res.status(400).json({ error: "No calendar URL set. Add your private iCal URL in Admin." });
  try {
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) return res.status(502).json({ error: "Calendar fetch failed (HTTP " + r.status + ")." });
    const text = await r.text();
    const parsed = parseICS(text);
    // Keep only future-ish events (from 30 days ago) to avoid unbounded growth.
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    const fresh = parsed.filter(e => e.date >= cutoffISO);
    if (!Array.isArray(state.events)) state.events = [];
    const manual = state.events.filter(e => e.source !== "ics");
    state.events = manual.concat(fresh);
    if (state.settings) state.settings.icsUrl = url, state.settings.lastCalendarSync = new Date().toISOString();
    db.saveState(state);
    res.json({ ok: true, imported: fresh.length, total: state.events.length });
  } catch (e) {
    res.status(502).json({ error: "Could not reach calendar URL: " + e.message });
  }
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`\n  ⚡ Life OS running at http://localhost:${PORT}`);
  console.log(`  Admin password: ${ADMIN_PASSWORD === "admin" ? "admin (set ADMIN_PASSWORD to change)" : "(custom)"}`);
  console.log(`  Database: ${db.DATA_DIR}\n`);
});
