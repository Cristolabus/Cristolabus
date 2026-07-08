/* ===== Life OS — Default seed data =====
 * This is loaded only on first run (or after Reset). All live state is then
 * persisted to localStorage under the key "lifeos.state". Editing the app
 * updates that saved state, not this file.
 *
 * To re-sync your real Google Calendar / Notion data, a Claude Code session
 * can regenerate the `events` / `tasks` arrays below and you can Import them.
 */
const SEED = {
  profile: {
    name: "Cristóbal",
    avatar: "🧗",
    timezone: "America/Santiago",
    xp: 0,
    level: 1,
    createdAt: todayISO(),
  },

  // Tunable rules for the gamification engine (editable in the Admin panel).
  settings: {
    streakThreshold: 60,   // % of habits done for a day to count toward streak
    noteXP: 5,             // XP for saving a note
    goalXP: 15,            // XP for hitting a health goal
  },

  // Daily discipline log: { "2026-06-26": { habits: {habitId: true}, xpEarned: 40 } }
  // Seeded with a realistic recent history so Analytics isn't blank on day one.
  log: seedLog(),

  habits: [
    { id: "h1", name: "Wake up before 7:00", ico: "🌅", xp: 15, cadence: "daily" },
    { id: "h2", name: "Workout / move 30 min", ico: "🏋️", xp: 20, cadence: "daily" },
    { id: "h3", name: "Deep work 90 min", ico: "🧠", xp: 25, cadence: "daily" },
    { id: "h4", name: "Read 20 pages", ico: "📚", xp: 10, cadence: "daily" },
    { id: "h5", name: "No screens after 23:00", ico: "🌙", xp: 10, cadence: "daily" },
    { id: "h6", name: "Track expenses", ico: "💸", xp: 10, cadence: "daily" },
  ],

  tasks: [
    { id: "t1", title: "Plan the week ahead", priority: "high", done: false, xp: 20 },
    { id: "t2", title: "Reply to pending emails", priority: "med", done: false, xp: 10 },
    { id: "t3", title: "Grocery run", priority: "low", done: false, xp: 5 },
    { id: "t4", title: "Review monthly budget", priority: "med", done: false, xp: 15 },
  ],

  events: [
    // Seeded examples — replace via Import or a sync session.
    { id: "e1", title: "Morning routine", date: todayISO(), time: "07:00", loc: "Home" },
    { id: "e2", title: "Focus block", date: todayISO(), time: "09:30", loc: "Desk" },
    { id: "e3", title: "Gym", date: todayISO(), time: "18:30", loc: "Local gym" },
    { id: "e4", title: "Weekly review", date: addDaysISO(2), time: "10:00", loc: "Home" },
  ],

  finance: {
    currency: "CLP",
    monthlyIncome: 1200000,
    budgets: [
      { id: "b1", name: "Rent & utilities", ico: "🏠", limit: 450000, spent: 450000 },
      { id: "b2", name: "Food & groceries", ico: "🛒", limit: 250000, spent: 142000 },
      { id: "b3", name: "Transport", ico: "🚌", limit: 80000, spent: 38000 },
      { id: "b4", name: "Fun & dining", ico: "🎉", limit: 120000, spent: 75000 },
      { id: "b5", name: "Savings & invest", ico: "📈", limit: 300000, spent: 300000 },
    ],
  },

  health: {
    metrics: [
      { id: "m1", name: "Sleep", ico: "😴", value: 7.2, unit: "h", goal: 8, dir: "up" },
      { id: "m2", name: "Steps", ico: "👟", value: 6400, unit: "", goal: 10000, dir: "up" },
      { id: "m3", name: "Water", ico: "💧", value: 1.4, unit: "L", goal: 2.5, dir: "up" },
      { id: "m4", name: "Weight", ico: "⚖️", value: 74, unit: "kg", goal: 72, dir: "down" },
    ],
  },

  notes: [
    { id: "n1", date: todayISO(), body: "Welcome to your Life OS 👋\nThis is your scratchpad. Capture ideas, wins, and reflections here." },
  ],
};

// ---- tiny date helpers (also used by app.js) ----
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function addDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function pad(n) { return String(n).padStart(2, "0"); }

// Deterministic demo history for the last 13 days (excludes today), showing a
// gentle upward consistency trend. Replaced as soon as you start checking habits.
function seedLog() {
  const habitDefs = { h1: 15, h2: 20, h3: 25, h4: 10, h5: 10, h6: 10 };
  const ids = Object.keys(habitDefs);
  // completion pattern per day (how many of the 6 habits were done), oldest→newest
  const pattern = [2, 3, 3, 4, 3, 5, 4, 5, 4, 6, 5, 6, 5];
  const log = {};
  for (let k = 0; k < pattern.length; k++) {
    const daysAgo = pattern.length - k;           // 13 … 1
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    const iso = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    const habits = {}; let xp = 0;
    for (let i = 0; i < pattern[k]; i++) { habits[ids[i]] = true; xp += habitDefs[ids[i]]; }
    log[iso] = { habits, xpEarned: xp };
  }
  return log;
}
