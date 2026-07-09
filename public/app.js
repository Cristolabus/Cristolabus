/* ===== Life OS — Application logic ===== */
"use strict";

/* ---------- State management ---------- */
function ensureSettings() {
  if (!S.settings) S.settings = {};
  const defaults = { streakThreshold: 60, noteXP: 5, goalXP: 15, weeklyGoalXP: 40, theme: "dark", remindersEnabled: false };
  for (const k in defaults) if (S.settings[k] === undefined) S.settings[k] = defaults[k];
}
// Backfill any missing top-level structures so a partial/old saved state
// can never crash the UI.
function normalizeState() {
  if (!S || typeof S !== "object") S = structuredClone(SEED);
  for (const key of ["profile", "log", "habits", "tasks", "events", "finance", "health", "notes", "settings", "goals"]) {
    if (S[key] === undefined || S[key] === null) S[key] = structuredClone(SEED[key]);
  }
  if (!S.finance.budgets) S.finance.budgets = [];
  if (!S.health.metrics) S.health.metrics = [];
  if (!Array.isArray(S.goals)) S.goals = [];
  for (const t of S.tasks) { if (!t.repeat) t.repeat = "none"; if (t.due === undefined) t.due = ""; if (t.lastDone === undefined) t.lastDone = ""; }
  if (!S.profile.level) S.profile.level = 1;
  if (S.profile.xp === undefined) S.profile.xp = 0;
  if (!S.profile.name) S.profile.name = "Friend";
  if (!S.profile.avatar) S.profile.avatar = "🧗";
  ensureSettings();
}
// Reset weekly goal progress when a new week starts.
function ensureGoalsWeek() {
  if (!Array.isArray(S.goals)) S.goals = [];
  const wk = mondayISO();
  let changed = false;
  for (const g of S.goals) {
    if (g.weekStart !== wk) { g.weekStart = wk; g.progress = 0; g.completedAwarded = false; changed = true; }
  }
  if (changed) saveState();
}
// Update a goal's progress and award XP the first time it's completed this week.
function bumpGoal(g, value) {
  const wasDone = g.progress >= g.target;
  g.progress = Math.max(0, value);
  const nowDone = g.progress >= g.target;
  if (!wasDone && nowDone && !g.completedAwarded) {
    g.completedAwarded = true;
    addXP(S.settings.weeklyGoalXP ?? 40, "Weekly goal: " + g.name);
  }
  saveState(); checkAchievements(); render();
}
// Persist: caches locally and (when logged in) syncs to the SQLite backend.
function saveState() {
  ensureSettings();
  Store.save(S);
}
let S = structuredClone(SEED);   // replaced by Store.load() during setup()
let currentView = "overview";

/* ---------- XP / level curve ---------- */
// XP needed to reach the NEXT level from the current one.
function xpForLevel(level) { return 100 + (level - 1) * 75; }
function titleForLevel(level) {
  const titles = [
    [1, "Novice"], [3, "Apprentice"], [5, "Disciplined"], [8, "Focused"],
    [12, "Relentless"], [16, "Master"], [22, "Sage"], [30, "Legend"],
  ];
  let t = "Novice";
  for (const [lvl, name] of titles) if (level >= lvl) t = name;
  return t;
}
function addXP(amount, reason) {
  S.profile.xp += amount;
  let leveled = false;
  while (S.profile.xp >= xpForLevel(S.profile.level)) {
    S.profile.xp -= xpForLevel(S.profile.level);
    S.profile.level++;
    leveled = true;
  }
  // also count toward today's earned XP
  const day = ensureDay(todayISO());
  day.xpEarned = (day.xpEarned || 0) + amount;
  saveState();
  if (leveled) {
    toast("🎉", "Level Up!", "You reached Level " + S.profile.level + " — " + titleForLevel(S.profile.level));
  } else if (reason) {
    toast("💎", "+" + amount + " XP", reason);
  }
}
function removeXP(amount) {
  // soft clawback when un-checking; never go below 0 overall
  S.profile.xp -= amount;
  while (S.profile.xp < 0 && S.profile.level > 1) {
    S.profile.level--;
    S.profile.xp += xpForLevel(S.profile.level);
  }
  if (S.profile.xp < 0) S.profile.xp = 0;
  const day = ensureDay(todayISO());
  day.xpEarned = Math.max(0, (day.xpEarned || 0) - amount);
  saveState();
}

/* ---------- Day log helpers ---------- */
function ensureDay(iso) {
  if (!S.log[iso]) S.log[iso] = { habits: {}, xpEarned: 0 };
  if (!S.log[iso].habits) S.log[iso].habits = {};
  return S.log[iso];
}

/* ---------- Habit scheduling ---------- */
// A habit with an empty (or missing) days array is daily; otherwise it's only
// scheduled on the listed weekdays (0=Sun … 6=Sat).
function habitScheduled(h, iso) {
  if (!h.days || h.days.length === 0) return true;
  const wd = new Date(iso + "T00:00:00").getDay();
  return h.days.includes(wd);
}
function scheduledHabits(iso) { return S.habits.filter(h => habitScheduled(h, iso)); }
const WD_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function cadenceLabel(h) {
  if (!h.days || h.days.length === 0) return "daily";
  if (h.days.length === 7) return "daily";
  return h.days.slice().sort().map(d => WD_NAMES[d]).join(" ");
}

/* ---------- Discipline & streaks ---------- */
// Discipline score for a day = % of that day's SCHEDULED habits completed.
function dayDisciplinePct(iso) {
  const sched = scheduledHabits(iso);
  const total = sched.length;
  if (!total) return 0;
  const day = S.log[iso];
  if (!day) return 0;
  const done = sched.filter(h => day.habits[h.id]).length;
  return Math.round((done / total) * 100);
}
function todayDisciplinePct() { return dayDisciplinePct(todayISO()); }

// A day "counts" for the streak if at least N% of habits were done.
// Synced from S.settings at the start of every render().
let STREAK_THRESHOLD = 60;
function currentStreak() {
  let streak = 0;
  let d = new Date();
  // If today not yet qualifying, start counting from yesterday so the streak
  // doesn't break mid-day.
  if (dayDisciplinePct(isoOf(d)) < STREAK_THRESHOLD) d.setDate(d.getDate() - 1);
  while (dayDisciplinePct(isoOf(d)) >= STREAK_THRESHOLD) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
function longestStreak() {
  const days = Object.keys(S.log).sort();
  let best = 0, run = 0, prev = null;
  for (const iso of days) {
    if (dayDisciplinePct(iso) < STREAK_THRESHOLD) { run = 0; prev = iso; continue; }
    if (prev && isConsecutive(prev, iso)) run++; else run = 1;
    best = Math.max(best, run);
    prev = iso;
  }
  return best;
}
function isConsecutive(a, b) {
  const da = new Date(a), db = new Date(b);
  return Math.round((db - da) / 86400000) === 1;
}
function isoOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

/* ---------- Achievements ---------- */
const ACHIEVEMENTS = [
  { id: "first_step", ico: "👣", name: "First Step", desc: "Complete your first habit", xp: 25, test: () => totalHabitChecks() >= 1 },
  { id: "perfect_day", ico: "🌟", name: "Perfect Day", desc: "100% discipline in a single day", xp: 50, test: () => Object.keys(S.log).some(d => dayDisciplinePct(d) === 100) },
  { id: "streak_3", ico: "🔥", name: "On Fire", desc: "3-day discipline streak", xp: 40, test: () => longestStreak() >= 3 },
  { id: "streak_7", ico: "🚀", name: "Unstoppable", desc: "7-day discipline streak", xp: 80, test: () => longestStreak() >= 7 },
  { id: "streak_30", ico: "💎", name: "Iron Will", desc: "30-day discipline streak", xp: 300, test: () => longestStreak() >= 30 },
  { id: "task_10", ico: "✅", name: "Getting Things Done", desc: "Complete 10 tasks", xp: 50, test: () => (S.profile.tasksDone || 0) >= 10 },
  { id: "level_5", ico: "🏅", name: "Rising", desc: "Reach Level 5", xp: 60, test: () => S.profile.level >= 5 },
  { id: "level_10", ico: "👑", name: "Ascended", desc: "Reach Level 10", xp: 120, test: () => S.profile.level >= 10 },
  { id: "saver", ico: "🐷", name: "Penny Wise", desc: "Stay under budget in every category", xp: 70, test: () => S.finance.budgets.every(b => b.spent <= b.limit) },
  { id: "centurion", ico: "💯", name: "Centurion", desc: "Earn 100 XP in one day", xp: 50, test: () => Object.values(S.log).some(d => (d.xpEarned || 0) >= 100) },
];
function totalHabitChecks() {
  return Object.values(S.log).reduce((sum, d) => sum + Object.values(d.habits || {}).filter(Boolean).length, 0);
}
function checkAchievements() {
  if (!S.profile.unlocked) S.profile.unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (!S.profile.unlocked.includes(a.id) && a.test()) {
      S.profile.unlocked.push(a.id);
      addXP(a.xp, null);
      toast(a.ico, "Achievement Unlocked!", a.name + " (+" + a.xp + " XP)");
    }
  }
  saveState();
}

/* ---------- Toasts ---------- */
function toast(ico, title, sub) {
  const wrap = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="t-ico">${ico}</span><div><div class="t-title">${esc(title)}</div><div class="t-sub">${esc(sub || "")}</div></div>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3900);
}

/* ---------- Utils ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function uid() { return "id" + Math.random().toString(36).slice(2, 9); }
function money(n) {
  const cur = S.finance.currency;
  if (cur === "CLP") return "$" + Math.round(n).toLocaleString("es-CL");
  return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n);
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/* ================= RENDERING ================= */
function render() {
  ensureSettings();
  ensureGoalsWeek();
  ensureTaskRecurrence();
  STREAK_THRESHOLD = S.settings.streakThreshold || 60;
  renderSidebar();
  renderTopbar();
  const root = document.getElementById("viewRoot");
  root.innerHTML = VIEWS[currentView]();
  bindViewEvents();
}

function renderSidebar() {
  const p = S.profile;
  document.getElementById("playerName").textContent = p.name;
  document.getElementById("playerAvatar").textContent = p.avatar;
  document.getElementById("playerTitle").textContent = titleForLevel(p.level);
  document.getElementById("playerLevel").textContent = p.level;
  const need = xpForLevel(p.level);
  document.getElementById("xpLevel").textContent = p.level;
  document.getElementById("xpCurrent").textContent = p.xp;
  document.getElementById("xpNeeded").textContent = need;
  document.getElementById("xpFill").style.width = Math.min(100, (p.xp / need) * 100) + "%";
}

function renderTopbar() {
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 19 ? "Good afternoon" : "Good evening";
  document.getElementById("greeting").textContent = `${greet}, ${S.profile.name.split(" ")[0]}`;
  document.getElementById("dateLine").textContent = fmtDate(todayISO());
  document.getElementById("topStreak").textContent = currentStreak();
  document.getElementById("topPoints").textContent = (S.log[todayISO()]?.xpEarned) || 0;
  document.getElementById("topDiscipline").textContent = todayDisciplinePct();
}

/* ---------- Daily mood & energy check-in ---------- */
const MOOD_EMOJI = ["😞", "😕", "😐", "🙂", "😄"];
const ENERGY_EMOJI = ["😴", "🥱", "🙂", "💪", "🚀"];
function setCheckin(field, value) {
  const day = ensureDay(todayISO());
  const first = day.mood == null && day.energy == null;
  day[field] = value;
  if (first) addXP(S.settings.checkinXP ?? 5, "Daily check-in");
  saveState(); render();
}
function checkinHTML() {
  const day = S.log[todayISO()] || {};
  const row = (arr, attr, val) => arr.map((e, i) =>
    `<button class="mood-btn ${val === i + 1 ? "sel" : ""}" data-${attr}="${i + 1}" title="${i + 1}/5">${e}</button>`).join("");
  return `<div class="card">
    <h2>🌤️ Daily Check-in ${(day.mood || day.energy) ? "<span class='up' style='font-size:12px'>logged ✓</span>" : ""}</h2>
    <div class="checkin-label">Mood</div>
    <div class="mood-row">${row(MOOD_EMOJI, "mood", day.mood)}</div>
    <div class="checkin-label" style="margin-top:10px">Energy</div>
    <div class="mood-row">${row(ENERGY_EMOJI, "energy", day.energy)}</div>
  </div>`;
}

/* ---------- Recurring tasks ---------- */
// Repeating tasks re-open when their period rolls over.
function ensureTaskRecurrence() {
  const today = todayISO(), wk = mondayISO();
  let changed = false;
  for (const t of S.tasks) {
    if (!t.repeat || t.repeat === "none" || !t.done || !t.lastDone) continue;
    const rolled = t.repeat === "daily" ? t.lastDone < today : mondayISO(t.lastDone) < wk;
    if (rolled) { t.done = false; changed = true; }
  }
  if (changed) saveState();
}
function fmtShort(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// Sort: incomplete first, then by due date (soonest, blanks last), then priority.
function sortedTasks() {
  const prioRank = { high: 0, med: 1, low: 2 };
  return S.tasks.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.due || "9999", bd = b.due || "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (prioRank[a.priority] ?? 1) - (prioRank[b.priority] ?? 1);
  });
}

/* ---------- Views ---------- */
const VIEWS = {
  overview() {
    const disc = todayDisciplinePct();
    const doneTasks = S.tasks.filter(t => t.done).length;
    const nextEvents = upcomingEvents().slice(0, 3);
    return `
      <div class="grid cols-4">
        ${kpi("🔥", currentStreak(), "Day streak", `Longest: ${longestStreak()} days`)}
        ${kpi("🎯", disc + "%", "Today's discipline", disc >= STREAK_THRESHOLD ? "<span class='up'>On track</span>" : "<span class='down'>Push harder</span>")}
        ${kpi("⭐", "Lv " + S.profile.level, titleForLevel(S.profile.level), `${S.profile.xp}/${xpForLevel(S.profile.level)} XP`)}
        ${kpi("✅", doneTasks + "/" + S.tasks.length, "Tasks done", "today")}
      </div>

      <div style="margin-top:18px">${checkinHTML()}</div>

      <div class="grid cols-2" style="margin-top:18px">
        <div class="card">
          <h2>🔥 Today's Discipline <span class="h-spacer"></span><button class="btn sm" data-go="habits">Open</button></h2>
          ${habitListHTML(true)}
        </div>
        <div class="card">
          <div class="ring" style="--p:${disc}">
            <div class="ring-inner">
              <div>
                <div class="ring-val">${disc}%</div>
                <div class="ring-lbl">consistency</div>
              </div>
            </div>
          </div>
          <p class="muted" style="text-align:center;margin-top:14px;font-size:13px">
            ${disc === 100 ? "Perfect day — flawless. 🌟" : disc >= 60 ? "Solid. Keep the streak alive." : "Every check counts. Start now."}
          </p>
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:18px">
        <div class="card">
          <h2>📅 Up Next <span class="h-spacer"></span><button class="btn sm" data-go="calendar">All</button></h2>
          ${nextEvents.length ? nextEvents.map(eventHTML).join("") : `<div class="empty">Nothing scheduled. Enjoy the space.</div>`}
        </div>
        <div class="card">
          <h2>✅ Priority Tasks <span class="h-spacer"></span><button class="btn sm" data-go="tasks">All</button></h2>
          ${S.tasks.filter(t => !t.done).slice(0, 4).map(taskHTML).join("") || `<div class="empty">All clear! 🎉</div>`}
        </div>
      </div>

      <div class="card" style="margin-top:18px">
        <h2>🎯 Weekly Goals <span class="h-spacer"></span><button class="btn sm" data-go="goals">Open</button></h2>
        ${(S.goals && S.goals.length) ? S.goals.map(g => {
          const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
          const done = g.progress >= g.target;
          return `<div class="budget-row">
            <div class="budget-head"><span>${g.ico || "🎯"} ${esc(g.name)} ${done ? "✓" : ""}</span><span>${g.progress}/${g.target}${esc(g.unit || "")}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${done ? "var(--green)" : "var(--accent)"}"></div></div>
          </div>`;
        }).join("") : `<div class="empty">No weekly goals yet.</div>`}
      </div>
    `;
  },

  habits() {
    const last30 = heatmapHTML();
    return `
      <h2 class="section-title">🔥 Habits &amp; Discipline</h2>
      <div class="grid cols-3">
        ${kpi("🔥", currentStreak(), "Current streak", `Longest: ${longestStreak()}`)}
        ${kpi("🎯", todayDisciplinePct() + "%", "Today", `${Object.values(ensureDay(todayISO()).habits).filter(Boolean).length}/${S.habits.length} done`)}
        ${kpi("📈", avgDisciplinePct() + "%", "30-day average", "consistency")}
      </div>
      <div class="card" style="margin-top:18px">
        <h2>Today's Habits</h2>
        ${habitListHTML(false)}
        <div class="row" style="margin-top:14px">
          <input class="input" id="newHabit" placeholder="New habit, e.g. Meditate 10 min" />
          <button class="btn" id="addHabit">Add</button>
        </div>
      </div>
      <div class="card" style="margin-top:18px">
        <h2>Last 30 Days</h2>
        ${last30}
        <p class="muted" style="margin-top:10px;font-size:12px">Darker = higher discipline that day. A day counts toward your streak at ${STREAK_THRESHOLD}%+.</p>
      </div>
    `;
  },

  goals() {
    const gs = S.goals || [];
    const done = gs.filter(g => g.progress >= g.target).length;
    return `
      <h2 class="section-title">🎯 Weekly Goals &amp; Targets</h2>
      <p class="muted" style="margin:-8px 0 16px;font-size:13px">Week of ${fmtDate(mondayISO())} — progress resets every Monday. ${gs.length ? `<b>${done}/${gs.length}</b> complete.` : ""}</p>
      <div class="grid cols-3">
        ${gs.map(goalCardHTML).join("") || `<div class="empty">No weekly goals yet. Add one below.</div>`}
      </div>
      <div class="card" style="margin-top:18px">
        <h2>Add a weekly goal</h2>
        <div class="row wrap">
          <input class="input" id="ngName" placeholder="Goal name, e.g. Runs" style="flex:1;min-width:140px">
          <input class="input" id="ngIco" placeholder="🎯" style="width:70px">
          <input class="input" id="ngTarget" type="number" placeholder="Target" style="width:100px">
          <input class="input" id="ngUnit" placeholder="unit (km, h…)" style="width:110px">
          <button class="btn" id="addGoal">Add goal</button>
        </div>
      </div>
    `;
  },

  tasks() {
    const sorted = sortedTasks();
    const active = sorted.filter(t => !t.done);
    const done = sorted.filter(t => t.done);
    return `
      <h2 class="section-title">✅ Tasks</h2>
      <div class="card">
        <div class="row wrap">
          <input class="input" id="newTask" placeholder="Add a task…" style="flex:1;min-width:160px" />
          <select id="newTaskPrio" style="width:auto">
            <option value="high">High</option>
            <option value="med" selected>Medium</option>
            <option value="low">Low</option>
          </select>
          <select id="newTaskRepeat" style="width:auto" title="Repeat">
            <option value="none">One-off</option>
            <option value="daily">🔁 Daily</option>
            <option value="weekly">🔁 Weekly</option>
          </select>
          <input class="input" id="newTaskDue" type="date" title="Due date" style="width:auto" />
          <button class="btn" id="addTask">Add</button>
        </div>
      </div>
      <div class="card" style="margin-top:18px">
        <h2>Active (${active.length})</h2>
        ${active.map(taskHTML).join("") || `<div class="empty">No active tasks. 🎉</div>`}
      </div>
      ${done.length ? `<div class="card" style="margin-top:18px"><h2>Completed (${done.length})</h2>${done.map(taskHTML).join("")}</div>` : ""}
    `;
  },

  calendar() {
    const grouped = groupEventsByDate(upcomingEvents());
    return `
      <h2 class="section-title">📅 Calendar</h2>
      <div class="card">
        <div class="row wrap">
          <input class="input" id="evTitle" placeholder="Event title" style="flex:2;min-width:160px" />
          <input class="input" id="evDate" type="date" value="${todayISO()}" style="width:auto" />
          <input class="input" id="evTime" type="time" value="09:00" style="width:auto" />
          <input class="input" id="evLoc" placeholder="Location" style="width:auto" />
          <button class="btn" id="addEvent">Add</button>
          ${(Store.isOnline() && Store.isAuthed()) ? `<button class="btn soft" id="calSyncBtn">🔄 Sync Google</button>` : ""}
        </div>
        <p class="muted" style="margin-top:10px;font-size:12px">💡 Connect your Google Calendar in <b>Admin → Google Calendar Sync</b> with its private iCal URL.</p>
      </div>
      <div class="card" style="margin-top:18px">
        ${Object.keys(grouped).length ? Object.entries(grouped).map(([date, evs]) =>
          `<div class="day-head">${fmtDate(date)}</div>${evs.map(eventHTML).join("")}`).join("")
          : `<div class="empty">No upcoming events.</div>`}
      </div>
    `;
  },

  finance() {
    const f = S.finance;
    const totalSpent = f.budgets.reduce((s, b) => s + b.spent, 0);
    const totalLimit = f.budgets.reduce((s, b) => s + b.limit, 0);
    const remaining = f.monthlyIncome - totalSpent;
    const spendSeries = f.budgets.slice().sort((a, b) => b.spent - a.spent).map(b => ({
      label: b.name, value: b.spent,
      color: b.spent > b.limit ? "#ff5d73" : "#7c5cff",
      tip: `${b.name}: ${money(b.spent)} of ${money(b.limit)}`,
    }));
    const savedPct = f.monthlyIncome ? Math.round((remaining / f.monthlyIncome) * 100) : 0;
    return `
      <h2 class="section-title">💰 Finance</h2>
      <div class="grid cols-4">
        ${kpi("💵", money(f.monthlyIncome), "Monthly income", "")}
        ${kpi("💸", money(totalSpent), "Spent this month", `of ${money(totalLimit)} budgeted`)}
        ${kpi("🏦", money(remaining), "Remaining", remaining >= 0 ? "<span class='up'>In the green</span>" : "<span class='down'>Over budget</span>")}
        ${kpi("📈", savedPct + "%", "Left to save", "of income")}
      </div>
      <div class="card" style="margin-top:18px">
        <h2>💸 Spending by category</h2>
        ${spendSeries.length ? `<div class="chart-wrap">${Charts.hbars(spendSeries, { max: Math.max(...f.budgets.map(b => b.limit), 1), valueFmt: money })}</div>` : `<div class="empty">No budgets yet.</div>`}
        <div class="chart-legend">
          <span><span class="dot" style="background:#7c5cff"></span>within budget</span>
          <span><span class="dot" style="background:#ff5d73"></span>over budget</span>
        </div>
      </div>
      <div class="card" style="margin-top:18px">
        <h2>Budgets</h2>
        ${f.budgets.map(budgetHTML).join("")}
        <div class="row wrap" style="margin-top:14px">
          <input class="input" id="bName" placeholder="Category" style="flex:1;min-width:120px" />
          <input class="input" id="bLimit" type="number" placeholder="Limit" style="width:120px" />
          <button class="btn" id="addBudget">Add</button>
        </div>
      </div>
    `;
  },

  health() {
    return `
      <h2 class="section-title">❤️ Health</h2>
      <div class="grid cols-2">
        ${S.health.metrics.map(metricHTML).join("")}
      </div>
      <p class="muted" style="margin-top:14px;font-size:13px">Click a value to update it. Hitting a goal earns XP. 💎</p>
    `;
  },

  notes() {
    return `
      <h2 class="section-title">📝 Notes</h2>
      <div class="card">
        <textarea id="noteBody" rows="3" placeholder="What's on your mind?"></textarea>
        <div class="row" style="margin-top:10px;justify-content:flex-end">
          <button class="btn" id="addNote">Save note</button>
        </div>
      </div>
      <div class="grid cols-2" style="margin-top:18px">
        ${S.notes.slice().reverse().map(noteHTML).join("") || `<div class="empty">No notes yet.</div>`}
      </div>
    `;
  },

  achievements() {
    if (!S.profile.unlocked) S.profile.unlocked = [];
    const unlocked = S.profile.unlocked.length;
    return `
      <h2 class="section-title">🏆 Achievements (${unlocked}/${ACHIEVEMENTS.length})</h2>
      <div class="grid cols-2">
        ${ACHIEVEMENTS.map(a => {
          const got = S.profile.unlocked.includes(a.id);
          return `<div class="ach ${got ? "" : "locked"}">
            <div class="ach-ico">${a.ico}</div>
            <div><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div></div>
            <div class="ach-xp">${got ? "✓ " : "+"}${a.xp} XP</div>
          </div>`;
        }).join("")}
      </div>
    `;
  },

  analytics() {
    const days = 14;
    const isos = lastNDays(days);
    const xpSeries = isos.map(iso => { const v = (S.log[iso]?.xpEarned) || 0; return { label: shortDay(iso), value: v, tip: fmtDate(iso) + " · " + v + " XP" }; });
    const discSeries = isos.map(iso => { const v = dayDisciplinePct(iso); return { label: shortDay(iso), value: v, tip: fmtDate(iso) + " · " + v + "%" }; });
    const moodSeries = isos.map(iso => { const v = (S.log[iso]?.mood) || 0; return { label: shortDay(iso), value: v, tip: fmtDate(iso) + " · mood " + (v || "—") + "/5" }; });
    const energySeries = isos.map(iso => { const v = (S.log[iso]?.energy) || 0; return { label: shortDay(iso), value: v, tip: fmtDate(iso) + " · energy " + (v || "—") + "/5" }; });
    const hasMood = moodSeries.some(d => d.value > 0);
    const habitBreak = S.habits.map(h => { const v = habitRate30(h.id); return { label: h.name, value: v, tip: h.name + " · " + v + "% of last 30 days" }; }).sort((a, b) => b.value - a.value);
    const totalXP14 = xpSeries.reduce((s, d) => s + d.value, 0);
    const bestDay = Math.max(0, ...xpSeries.map(d => d.value));
    const avgDisc = Math.round(discSeries.reduce((s, d) => s + d.value, 0) / days);

    const legend = (color, label) => `<div class="chart-legend"><span><span class="dot" style="background:${color}"></span>${esc(label)}</span></div>`;

    return `
      <h2 class="section-title">📊 Analytics</h2>
      <div class="grid cols-4">
        ${kpi("💎", totalXP14, "XP earned", "last 14 days")}
        ${kpi("📈", avgDisc + "%", "Avg discipline", "last 14 days")}
        ${kpi("🥇", bestDay, "Best day", "XP in one day")}
        ${kpi("🔥", longestStreak(), "Longest streak", "days")}
      </div>
      <div class="card" style="margin-top:18px"><h2>💎 XP earned per day</h2>
        <div class="chart-wrap">${Charts.bar(xpSeries, { color: "#7c5cff", unit: " XP" })}</div>
        ${legend("#7c5cff", "XP per day")}
      </div>
      <div class="card" style="margin-top:18px"><h2>🎯 Discipline over time</h2>
        <div class="chart-wrap">${Charts.line(discSeries, { color: "#4dd6ff", unit: "%", max: 100 })}</div>
        ${legend("#4dd6ff", "Daily discipline %")}
      </div>
      ${hasMood ? `<div class="card" style="margin-top:18px"><h2>🌤️ Mood &amp; energy</h2>
        <div class="chart-wrap">${Charts.line(moodSeries, { color: "#ffb347", unit: "/5", max: 5 })}</div>
        <div class="chart-wrap" style="margin-top:6px">${Charts.line(energySeries, { color: "#3ddc97", unit: "/5", max: 5 })}</div>
        <div class="chart-legend"><span><span class="dot" style="background:#ffb347"></span>Mood</span><span><span class="dot" style="background:#3ddc97"></span>Energy</span></div>
      </div>` : ""}
      <div class="card" style="margin-top:18px"><h2>🔥 Habit consistency — last 30 days</h2>
        ${habitBreak.length ? `<div class="chart-wrap">${Charts.hbars(habitBreak, { color: "#3ddc97" })}</div>` : `<div class="empty">Add some habits to see consistency here.</div>`}
      </div>
    `;
  },

  admin() {
    const online = Store.isOnline();

    let html = `<h2 class="section-title">⚙️ Admin &amp; Settings</h2>`;

    // ---- account / backend status ----
    html += `<div class="card"><h2>🔌 Account <span class="h-spacer"></span>
      <span class="badge ${online ? "on" : "off"}">${online ? "Signed in" : "Offline — local only"}</span></h2>`;
    if (online) {
      html += `<div class="row"><p class="muted" style="font-size:13px;flex:1">Signed in as <b>${esc(Store.getUsername() || "user")}</b> — your data is private to this account and synced to the database.</p>
        <button class="btn sm soft" id="logoutBtn">Log out</button></div>`;
    } else {
      html += `<p class="muted" style="font-size:13px">No server detected — you're editing local browser data. Run <code>npm start</code> for multi-user accounts with database storage.</p>`;
    }
    html += `</div>`;

    // ---- profile & rules ----
    html += `<div class="card"><h2>👤 Profile &amp; Rules</h2>
      <div class="grid cols-2">
        <div class="field"><label>Name</label><input class="input" id="setName" value="${esc(S.profile.name)}"></div>
        <div class="field"><label>Avatar emoji</label><input class="input" id="setAvatar" value="${esc(S.profile.avatar)}"></div>
        <div class="field"><label>Timezone</label><input class="input" id="setTz" value="${esc(S.profile.timezone || "")}"></div>
        <div class="field"><label>Currency code (e.g. CLP, USD, EUR)</label><input class="input" id="setCurrency" value="${esc(S.finance.currency)}"></div>
        <div class="field"><label>Monthly income</label><input class="input" id="setIncome" type="number" value="${S.finance.monthlyIncome}"></div>
        <div class="field"><label>Streak threshold (%)</label><input class="input" id="setThreshold" type="number" value="${S.settings.streakThreshold}"></div>
        <div class="field"><label>Note XP</label><input class="input" id="setNoteXP" type="number" value="${S.settings.noteXP}"></div>
        <div class="field"><label>Goal XP</label><input class="input" id="setGoalXP" type="number" value="${S.settings.goalXP}"></div>
      </div>
      <button class="btn" id="saveSettings">Save settings</button>
    </div>`;

    // ---- Google Calendar sync ----
    html += `<div class="card"><h2>🔗 Google Calendar Sync</h2>
      <div class="field"><label>Private iCal URL (Google Calendar → Settings → "Secret address in iCal format")</label>
        <input class="input" id="setIcs" value="${esc(S.settings.icsUrl || "")}" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"></div>
      <div class="row wrap">
        <button class="btn" id="syncCalBtn">🔄 Sync now</button>
        <button class="btn soft" id="saveIcs">Save URL</button>
        <span class="muted" style="font-size:12px">${S.settings.lastCalendarSync ? "Last synced: " + new Date(S.settings.lastCalendarSync).toLocaleString() : "Never synced"}</span>
      </div>
      <p class="muted" style="font-size:12px;margin-top:8px">Pulls your real events into the Calendar. Synced events are replaced on each sync; manually-added events are kept.</p>
    </div>`;

    // ---- reminders ----
    const perm = (typeof Notification !== "undefined") ? Notification.permission : "unsupported";
    html += `<div class="card"><h2>🔔 Reminders</h2>
      <p class="muted" style="font-size:13px">Get a browser notification 5 minutes before a calendar event starts (while the dashboard is open).</p>
      <div class="row wrap" style="margin-top:8px">
        <button class="btn" id="enableReminders">${(S.settings.remindersEnabled && perm === "granted") ? "✓ Reminders on" : "Enable reminders"}</button>
        <span class="muted" style="font-size:12px">Permission: ${perm}</span>
      </div>
    </div>`;

    // ---- habits (with weekday cadence) ----
    html += `<div class="card"><h2>🔥 Manage Habits</h2>
      <div id="habitRows">` +
      S.habits.map(h => {
        const days = h.days || [];
        const wd = WD_NAMES.map((nm, i) => `<button type="button" class="wd ${(!days.length || days.includes(i)) ? "on" : ""}" data-wd="${i}">${nm[0]}</button>`).join("");
        return `<div class="admin-item" data-id="${h.id}">
          <div class="admin-grid">
            <div class="habit-ico">${h.ico}</div>
            <input class="input" data-h-name value="${esc(h.name)}">
            <input class="input mini" data-h-ico value="${esc(h.ico)}">
            <input class="input mini" data-h-xp type="number" value="${h.xp}">
            <button class="icon-btn" data-delhabit="${h.id}" title="Delete">✕</button>
          </div>
          <div class="wd-row">${wd}<span class="muted" style="font-size:11px;margin-left:8px">pick days · all selected = daily</span></div>
        </div>`;
      }).join("") + `</div>
      <div class="row wrap" style="margin-top:12px">
        <input class="input" id="ahName" placeholder="New habit name" style="flex:1;min-width:140px">
        <input class="input" id="ahIco" placeholder="✨" style="width:70px">
        <input class="input" id="ahXp" type="number" placeholder="XP" style="width:80px">
        <button class="btn soft" id="addHabitAdmin">Add</button>
        <button class="btn" id="saveHabits">Save all</button>
      </div>
    </div>`;

    // ---- weekly goals ----
    html += `<div class="card"><h2>🎯 Manage Weekly Goals</h2>
      <div class="admin-grid admin-head" style="grid-template-columns:48px 1.4fr 70px 70px auto"><span></span><span>Name</span><span>Target</span><span>Unit</span><span></span></div>
      <div id="goalRows">` +
      S.goals.map(g => `<div class="admin-grid" data-id="${g.id}" style="grid-template-columns:48px 1.4fr 70px 70px auto">
        <input class="input mini" data-g-ico value="${esc(g.ico || "")}" style="width:48px">
        <input class="input" data-g-name value="${esc(g.name)}">
        <input class="input mini" data-g-target type="number" value="${g.target}">
        <input class="input mini" data-g-unit value="${esc(g.unit || "")}">
        <button class="icon-btn" data-delgoal="${g.id}">✕</button>
      </div>`).join("") + `</div>
      <button class="btn" id="saveGoals" style="margin-top:12px">Save goals</button>
    </div>`;

    // ---- tasks (with priority) ----
    html += `<div class="card"><h2>✅ Manage Tasks</h2><div id="taskRows">` +
      (S.tasks.length ? S.tasks.map(t => `<div class="admin-row" data-id="${t.id}" style="grid-template-columns:30px 1fr 84px 96px 138px auto">
        <div>${t.done ? "✅" : "⬜"}</div>
        <input class="input" data-t-title value="${esc(t.title)}">
        <select class="input" data-t-prio style="width:84px">
          ${["high", "med", "low"].map(p => `<option value="${p}" ${t.priority === p ? "selected" : ""}>${p}</option>`).join("")}
        </select>
        <select class="input" data-t-repeat style="width:96px">
          ${[["none", "one-off"], ["daily", "🔁 daily"], ["weekly", "🔁 weekly"]].map(([v, l]) => `<option value="${v}" ${(t.repeat || "none") === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <input class="input" data-t-due type="date" value="${t.due || ""}">
        <button class="icon-btn" data-deltask="${t.id}">✕</button>
      </div>`).join("") : `<div class="empty">No tasks.</div>`) + `</div>
      <div class="row" style="margin-top:12px"><button class="btn soft" id="clearDone">Clear completed</button><button class="btn" id="saveTasks">Save tasks</button></div>
    </div>`;

    // ---- budgets ----
    html += `<div class="card"><h2>💰 Manage Budgets</h2>
      <div class="admin-grid admin-head"><span></span><span>Category</span><span>Limit</span><span>Spent</span><span></span></div>
      <div id="budgetRows">` +
      S.finance.budgets.map(b => `<div class="admin-grid" data-id="${b.id}">
        <input class="input mini" data-b-ico value="${esc(b.ico || "")}" style="width:48px">
        <input class="input" data-b-name value="${esc(b.name)}">
        <input class="input mini" data-b-limit type="number" value="${b.limit}">
        <input class="input mini" data-b-spent type="number" value="${b.spent}">
        <button class="icon-btn" data-delbudget="${b.id}">✕</button>
      </div>`).join("") + `</div>
      <div class="row wrap" style="margin-top:12px">
        <input class="input" id="abName" placeholder="New category" style="flex:1;min-width:120px">
        <input class="input" id="abIco" placeholder="•" style="width:60px">
        <input class="input" id="abLimit" type="number" placeholder="Limit" style="width:110px">
        <button class="btn soft" id="addBudgetAdmin">Add</button>
        <button class="btn" id="saveBudgets">Save budgets</button>
      </div>
    </div>`;

    // ---- health ----
    const mCols = "grid-template-columns:48px 1.3fr 64px 64px 50px 74px auto";
    html += `<div class="card"><h2>❤️ Manage Health Metrics</h2><div id="metricRows">` +
      S.health.metrics.map(m => `<div class="admin-grid" data-id="${m.id}" style="${mCols}">
        <input class="input mini" data-m-ico value="${esc(m.ico || "")}" style="width:48px">
        <input class="input" data-m-name value="${esc(m.name)}">
        <input class="input mini" data-m-value type="number" value="${m.value}">
        <input class="input mini" data-m-goal type="number" value="${m.goal}">
        <input class="input mini" data-m-unit value="${esc(m.unit || "")}" style="width:50px">
        <select class="input mini" data-m-dir style="width:74px"><option value="up" ${m.dir !== "down" ? "selected" : ""}>up ↑</option><option value="down" ${m.dir === "down" ? "selected" : ""}>down ↓</option></select>
        <button class="icon-btn" data-delmetric="${m.id}">✕</button>
      </div>`).join("") + `</div>
      <div class="row wrap" style="margin-top:12px">
        <input class="input" id="amIco" placeholder="❤️" style="width:60px">
        <input class="input" id="amName" placeholder="Metric name" style="flex:1;min-width:120px">
        <input class="input" id="amValue" type="number" placeholder="Value" style="width:90px">
        <input class="input" id="amGoal" type="number" placeholder="Goal" style="width:90px">
        <input class="input" id="amUnit" placeholder="unit" style="width:70px">
        <select class="input" id="amDir" style="width:90px"><option value="up">up ↑</option><option value="down">down ↓</option></select>
        <button class="btn soft" id="addMetric">Add</button>
        <button class="btn" id="saveHealth">Save metrics</button>
      </div>
    </div>`;

    // ---- events (editable) ----
    const eCols = "grid-template-columns:1.4fr 140px 96px 1fr auto";
    html += `<div class="card"><h2>📅 Manage Events</h2><div id="eventRows">` +
      (S.events.length ? S.events.map(e => `<div class="admin-grid" data-id="${e.id}" style="${eCols}">
        <input class="input" data-e-title value="${esc(e.title)}">
        <input class="input" data-e-date type="date" value="${e.date}">
        <input class="input" data-e-time type="time" value="${e.time || ""}">
        <input class="input" data-e-loc value="${esc(e.loc || "")}" placeholder="location">
        <button class="icon-btn" data-delevent="${e.id}">✕</button>
      </div>`).join("") : `<div class="empty">No events.</div>`) + `</div>
      <div class="row wrap" style="margin-top:12px">
        <input class="input" id="aeTitle" placeholder="Event title" style="flex:1;min-width:140px">
        <input class="input" id="aeDate" type="date" value="${todayISO()}" style="width:auto">
        <input class="input" id="aeTime" type="time" value="09:00" style="width:auto">
        <input class="input" id="aeLoc" placeholder="Location" style="width:auto">
        <button class="btn soft" id="addEventAdmin">Add</button>
        <button class="btn" id="saveEvents">Save events</button>
      </div>
    </div>`;

    // ---- notes (editable) ----
    html += `<div class="card"><h2>📝 Manage Notes</h2><div id="noteRows">` +
      (S.notes.length ? S.notes.slice().reverse().map(n => `<div class="admin-item" data-id="${n.id}">
        <div class="row"><span class="muted" style="font-size:12px;flex:1">${fmtDate(n.date)}</span><button class="icon-btn" data-delnote="${n.id}">✕</button></div>
        <textarea class="input" data-n-body rows="2">${esc(n.body)}</textarea>
      </div>`).join("") : `<div class="empty">No notes.</div>`) + `</div>
      <button class="btn" id="saveNotes" style="margin-top:12px">Save notes</button>
    </div>`;

    // ---- danger zone ----
    html += `<div class="card danger-zone"><h2>⚠️ Danger Zone</h2>
      <div class="row wrap">
        <button class="btn soft" id="adminExport">⬇ Export backup</button>
        <button class="ghost-btn danger" id="wipeAll" style="flex:0 0 auto;min-width:160px">Wipe all data &amp; reset</button>
      </div>
      <p class="muted" style="font-size:12px;margin-top:10px">Wipe erases ${online ? "the database" : "local data"} and resets everything to defaults.</p>
    </div>`;

    return html;
  },
};

/* ---------- HTML fragments ---------- */
function kpi(ico, val, label, sub) {
  return `<div class="card kpi"><div class="kpi-ico">${ico}</div><div class="kpi-val">${val}</div><div class="kpi-label">${esc(label)}</div><div class="kpi-sub">${sub || ""}</div></div>`;
}
function habitListHTML(compact) {
  const iso = todayISO();
  const day = ensureDay(iso);
  const todays = scheduledHabits(iso);
  if (!todays.length) return `<div class="empty">No habits scheduled for today — rest day. 🌿</div>`;
  return todays.map(h => {
    const done = !!day.habits[h.id];
    const st = habitStreak(h.id);
    return `<div class="habit">
      <div class="habit-ico">${h.ico}</div>
      <div>
        <div class="habit-name">${esc(h.name)}</div>
        ${compact ? "" : `<div class="habit-meta">+${h.xp} XP · ${esc(cadenceLabel(h))}</div>`}
      </div>
      <div class="streak-chip">${st > 0 ? "🔥 " + st : ""}</div>
      <button class="check ${done ? "done" : ""}" data-habit="${h.id}">✓</button>
      ${compact ? "" : `<button class="icon-btn" data-delhabit="${h.id}" title="Delete habit">✕</button>`}
    </div>`;
  }).join("");
}
function habitStreak(id) {
  const h = S.habits.find(x => x.id === id);
  if (!h) return 0;
  let streak = 0, d = new Date();
  // Only scheduled days count; today not-yet-done doesn't break the streak.
  for (let i = 0; i < 400; i++) {
    const iso = isoOf(d);
    if (habitScheduled(h, iso)) {
      if (S.log[iso]?.habits?.[id]) streak++;
      else if (i === 0) { /* today pending — keep going */ }
      else break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
function taskHTML(t) {
  const overdue = t.due && !t.done && t.due < todayISO();
  const dueTag = t.due ? `<span class="tag ${overdue ? "p-high" : ""}">${overdue ? "⚠ " : "📅 "}${fmtShort(t.due)}</span>` : "";
  const repTag = (t.repeat && t.repeat !== "none") ? `<span class="tag">🔁 ${t.repeat}</span>` : "";
  return `<div class="task ${t.done ? "done" : ""}">
    <button class="check ${t.done ? "done" : ""}" data-task="${t.id}">✓</button>
    <span class="task-title">${esc(t.title)}</span>
    ${dueTag}${repTag}
    <span class="tag p-${t.priority}">${t.priority}</span>
    <button class="icon-btn" data-deltask="${t.id}">✕</button>
  </div>`;
}
function eventHTML(e) {
  return `<div class="event">
    <div class="event-time">${e.time || "—"}</div>
    <div><div class="event-title">${esc(e.title)}</div>${e.loc ? `<div class="event-loc">📍 ${esc(e.loc)}</div>` : ""}</div>
  </div>`;
}
function budgetHTML(b) {
  const pct = Math.min(100, Math.round((b.spent / b.limit) * 100));
  const over = b.spent > b.limit;
  const color = over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--green)";
  return `<div class="budget-row">
    <div class="budget-head"><span>${b.ico || "•"} ${esc(b.name)}</span><span>${money(b.spent)} <span class="budget-sub">/ ${money(b.limit)}</span></span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="row" style="margin-top:8px;gap:6px">
      <input class="input" type="number" data-spend="${b.id}" placeholder="Add expense" style="height:32px;font-size:12px" />
      <button class="btn sm soft" data-addspend="${b.id}">Log</button>
    </div>
  </div>`;
}
function metricHTML(m) {
  const pct = Math.min(100, Math.round((m.dir === "down" ? (m.goal / m.value) : (m.value / m.goal)) * 100));
  const hit = m.dir === "down" ? m.value <= m.goal : m.value >= m.goal;
  return `<div class="card">
    <h2>${m.ico} ${esc(m.name)} ${hit ? "<span class='up' style='font-size:12px'>goal ✓</span>" : ""}</h2>
    <div class="kpi-val" style="font-size:26px" data-metric="${m.id}" title="Click to edit">${m.value}${m.unit}</div>
    <div class="budget-sub">Goal: ${m.goal}${m.unit}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${hit ? "var(--green)" : "var(--accent)"}"></div></div>
  </div>`;
}
function noteHTML(n) {
  return `<div class="note"><div class="note-date">${fmtDate(n.date)} <button class="icon-btn" data-delnote="${n.id}" style="float:right">✕</button></div><div class="note-body">${esc(n.body)}</div></div>`;
}
function goalCardHTML(g) {
  const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
  const done = g.progress >= g.target;
  return `<div class="card">
    <h2>${g.ico || "🎯"} ${esc(g.name)} ${done ? "<span class='up' style='font-size:12px'>done ✓</span>" : ""}</h2>
    <div class="kpi-val" style="font-size:26px">${g.progress}<span class="muted" style="font-size:15px">/${g.target}${esc(g.unit || "")}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${done ? "var(--green)" : "var(--accent)"}"></div></div>
    <div class="row" style="margin-top:12px">
      <button class="btn sm soft" data-goaldec="${g.id}" title="−1">−</button>
      <input class="input" data-goalset="${g.id}" type="number" value="${g.progress}" style="width:76px;height:34px">
      <button class="btn sm soft" data-goalinc="${g.id}" title="+1">+</button>
      <span class="h-spacer" style="flex:1"></span>
      ${done ? "" : `<button class="btn sm" data-goaldone="${g.id}">Complete</button>`}
    </div>
  </div>`;
}

/* ---------- Heatmap ---------- */
function heatmapHTML() {
  let cells = "";
  for (let i = 29; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const pct = dayDisciplinePct(isoOf(d));
    const lvl = pct === 0 ? "" : pct < 34 ? "l1" : pct < 67 ? "l2" : pct < 100 ? "l3" : "l4";
    cells += `<div class="heat-cell ${lvl}" title="${isoOf(d)}: ${pct}%"></div>`;
  }
  return `<div class="heat">${cells}</div>`;
}
function avgDisciplinePct() {
  let sum = 0;
  for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); sum += dayDisciplinePct(isoOf(d)); }
  return Math.round(sum / 30);
}

/* ---------- Analytics helpers ---------- */
function lastNDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(isoOf(d)); }
  return out;
}
function shortDay(iso) { return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { day: "numeric" }); }
function habitRate30(id) {
  let done = 0;
  for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); if (S.log[isoOf(d)]?.habits?.[id]) done++; }
  return Math.round((done / 30) * 100);
}

/* ---------- Event/date helpers ---------- */
function upcomingEvents() {
  const today = todayISO();
  return S.events.filter(e => e.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
function groupEventsByDate(evs) {
  const g = {};
  for (const e of evs) { (g[e.date] = g[e.date] || []).push(e); }
  return g;
}

/* ================= INTERACTIONS ================= */
function bindViewEvents() {
  const root = document.getElementById("viewRoot");

  // nav shortcuts
  root.querySelectorAll("[data-go]").forEach(b => b.onclick = () => switchView(b.dataset.go));

  // chart tooltips
  const tip = document.getElementById("chartTip");
  root.querySelectorAll("[data-tip]").forEach(el => {
    el.addEventListener("mousemove", e => {
      tip.textContent = el.getAttribute("data-tip");
      tip.style.left = e.clientX + "px";
      tip.style.top = e.clientY + "px";
      tip.classList.add("show");
    });
    el.addEventListener("mouseleave", () => tip.classList.remove("show"));
  });

  // habit toggle
  root.querySelectorAll("[data-habit]").forEach(b => b.onclick = () => {
    const id = b.dataset.habit;
    const day = ensureDay(todayISO());
    const h = S.habits.find(x => x.id === id);
    if (day.habits[id]) { day.habits[id] = false; removeXP(h.xp); }
    else { day.habits[id] = true; addXP(h.xp, h.name); }
    saveState(); checkAchievements(); render();
  });

  // add habit
  on(root, "addHabit", () => {
    const v = val("newHabit"); if (!v) return;
    S.habits.push({ id: uid(), name: v, ico: "✨", xp: 10, cadence: "daily" });
    saveState(); render();
  });

  // task toggle / add / delete
  root.querySelectorAll("[data-task]").forEach(b => b.onclick = () => {
    const t = S.tasks.find(x => x.id === b.dataset.task);
    t.done = !t.done;
    if (t.done) { t.lastDone = todayISO(); addXP(t.xp || 10, "Task: " + t.title); S.profile.tasksDone = (S.profile.tasksDone || 0) + 1; }
    else { t.lastDone = ""; removeXP(t.xp || 10); S.profile.tasksDone = Math.max(0, (S.profile.tasksDone || 0) - 1); }
    saveState(); checkAchievements(); render();
  });
  root.querySelectorAll("[data-deltask]").forEach(b => b.onclick = () => {
    S.tasks = S.tasks.filter(t => t.id !== b.dataset.deltask); saveState(); render();
  });
  on(root, "addTask", () => {
    const v = val("newTask"); if (!v) return;
    S.tasks.unshift({
      id: uid(), title: v, priority: document.getElementById("newTaskPrio").value, done: false, xp: 10,
      repeat: document.getElementById("newTaskRepeat").value, due: val("newTaskDue"), lastDone: "",
    });
    saveState(); render();
  });

  // daily check-in
  root.querySelectorAll("[data-mood]").forEach(b => b.onclick = () => setCheckin("mood", parseInt(b.dataset.mood)));
  root.querySelectorAll("[data-energy]").forEach(b => b.onclick = () => setCheckin("energy", parseInt(b.dataset.energy)));

  // events
  on(root, "addEvent", () => {
    const title = val("evTitle"); if (!title) return;
    S.events.push({ id: uid(), title, date: val("evDate"), time: val("evTime"), loc: val("evLoc") });
    saveState(); render();
  });
  on(root, "calSyncBtn", async () => {
    if (!S.settings.icsUrl) { toast("⚠️", "No calendar URL", "Set it in Admin → Google Calendar Sync."); switchView("admin"); return; }
    toast("🔄", "Syncing…", "Fetching your calendar");
    const r = await Store.syncCalendar(S.settings.icsUrl);
    if (r.ok) { S = await Store.load(SEED); normalizeState(); scheduleReminders(); render(); toast("✅", "Calendar synced", r.imported + " events imported"); }
    else toast("⚠️", "Sync failed", r.error);
  });

  // budgets
  root.querySelectorAll("[data-addspend]").forEach(b => b.onclick = () => {
    const id = b.dataset.addspend;
    const inp = root.querySelector(`[data-spend="${id}"]`);
    const amt = parseFloat(inp.value); if (!amt) return;
    const bud = S.finance.budgets.find(x => x.id === id);
    bud.spent += amt; saveState(); checkAchievements(); render();
  });
  on(root, "addBudget", () => {
    const name = val("bName"), limit = parseFloat(val("bLimit"));
    if (!name || !limit) return;
    S.finance.budgets.push({ id: uid(), name, ico: "•", limit, spent: 0 });
    saveState(); render();
  });

  // health metrics — click to edit
  root.querySelectorAll("[data-metric]").forEach(el => el.onclick = () => {
    const m = S.health.metrics.find(x => x.id === el.dataset.metric);
    const v = prompt(`Update ${m.name} (${m.unit || "value"}):`, m.value);
    if (v === null) return;
    const wasHit = m.dir === "down" ? m.value <= m.goal : m.value >= m.goal;
    m.value = parseFloat(v) || 0;
    const nowHit = m.dir === "down" ? m.value <= m.goal : m.value >= m.goal;
    if (!wasHit && nowHit) addXP(S.settings.goalXP ?? 15, m.name + " goal reached!");
    saveState(); checkAchievements(); render();
  });

  // notes
  on(root, "addNote", () => {
    const body = val("noteBody"); if (!body) return;
    S.notes.push({ id: uid(), date: todayISO(), body });
    addXP(S.settings.noteXP ?? 5, "Captured a note");
    saveState(); render();
  });
  root.querySelectorAll("[data-delnote]").forEach(b => b.onclick = () => {
    S.notes = S.notes.filter(n => n.id !== b.dataset.delnote); saveState(); render();
  });

  // ---- global delete handlers (work in Admin and inline) ----
  root.querySelectorAll("[data-delhabit]").forEach(b => b.onclick = () => {
    const h = S.habits.find(x => x.id === b.dataset.delhabit);
    if (!confirm(`Delete habit "${h ? h.name : ""}"? Its history stays in past logs.`)) return;
    S.habits = S.habits.filter(x => x.id !== b.dataset.delhabit);
    saveState(); render();
  });
  root.querySelectorAll("[data-delbudget]").forEach(b => b.onclick = () => {
    S.finance.budgets = S.finance.budgets.filter(x => x.id !== b.dataset.delbudget); saveState(); render();
  });
  root.querySelectorAll("[data-delmetric]").forEach(b => b.onclick = () => {
    S.health.metrics = S.health.metrics.filter(x => x.id !== b.dataset.delmetric); saveState(); render();
  });
  root.querySelectorAll("[data-delevent]").forEach(b => b.onclick = () => {
    S.events = S.events.filter(x => x.id !== b.dataset.delevent); saveState(); render();
  });
  root.querySelectorAll("[data-delgoal]").forEach(b => b.onclick = () => {
    S.goals = S.goals.filter(x => x.id !== b.dataset.delgoal); saveState(); render();
  });

  // ---- weekly goals ----
  const goalById = id => S.goals.find(g => g.id === id);
  root.querySelectorAll("[data-goalinc]").forEach(b => b.onclick = () => { const g = goalById(b.dataset.goalinc); bumpGoal(g, g.progress + 1); });
  root.querySelectorAll("[data-goaldec]").forEach(b => b.onclick = () => { const g = goalById(b.dataset.goaldec); bumpGoal(g, g.progress - 1); });
  root.querySelectorAll("[data-goaldone]").forEach(b => b.onclick = () => { const g = goalById(b.dataset.goaldone); bumpGoal(g, g.target); });
  root.querySelectorAll("[data-goalset]").forEach(el => el.onchange = () => { const g = goalById(el.dataset.goalset); bumpGoal(g, parseFloat(el.value) || 0); });
  on(root, "addGoal", () => {
    const name = val("ngName"), target = num("ngTarget", 0);
    if (!name || !target) return;
    S.goals.push({ id: uid(), name, ico: val("ngIco") || "🎯", target, unit: val("ngUnit"), progress: 0, weekStart: mondayISO(), completedAwarded: false });
    saveState(); render();
  });

  if (currentView === "admin") bindAdmin(root);
}

/* ---------- Admin panel bindings ---------- */
function bindAdmin(root) {
  // account
  on(root, "logoutBtn", () => {
    Store.logout();
    if (Store.isOnline()) { forceCloseModal(); showAuth(); }
    else render();
  });

  // settings
  on(root, "saveSettings", () => {
    S.profile.name = val("setName") || S.profile.name;
    S.profile.avatar = val("setAvatar") || S.profile.avatar;
    S.profile.timezone = val("setTz");
    S.finance.currency = val("setCurrency") || S.finance.currency;
    S.finance.monthlyIncome = num("setIncome", S.finance.monthlyIncome);
    S.settings.streakThreshold = clamp(num("setThreshold", 60), 1, 100);
    S.settings.noteXP = num("setNoteXP", 5);
    S.settings.goalXP = num("setGoalXP", 15);
    S.settings.icsUrl = val("setIcs");
    saveState(); render(); toast("✅", "Settings saved", "");
  });

  // calendar sync
  on(root, "saveIcs", () => { S.settings.icsUrl = val("setIcs"); saveState(); render(); toast("✅", "URL saved", ""); });
  on(root, "syncCalBtn", async () => {
    const url = val("setIcs");
    if (!url) return toast("⚠️", "No URL", "Paste your private iCal URL first.");
    S.settings.icsUrl = url; saveState();
    toast("🔄", "Syncing…", "Fetching your calendar");
    const r = await Store.syncCalendar(url);
    if (r.ok) { S = await Store.load(SEED); normalizeState(); scheduleReminders(); render(); toast("✅", "Calendar synced", r.imported + " events imported"); }
    else toast("⚠️", "Sync failed", r.error);
  });

  // reminders
  on(root, "enableReminders", enableReminders);

  // habits (+ weekday cadence toggles)
  root.querySelectorAll(".wd-row .wd").forEach(btn => btn.onclick = () => btn.classList.toggle("on"));
  on(root, "addHabitAdmin", () => {
    const name = val("ahName"); if (!name) return;
    S.habits.push({ id: uid(), name, ico: val("ahIco") || "✨", xp: num("ahXp", 10), days: [] });
    saveState(); render();
  });
  on(root, "saveHabits", () => {
    root.querySelectorAll("#habitRows .admin-item").forEach(item => {
      const h = S.habits.find(x => x.id === item.dataset.id); if (!h) return;
      h.name = item.querySelector("[data-h-name]").value.trim() || h.name;
      h.ico = item.querySelector("[data-h-ico]").value.trim() || h.ico;
      h.xp = parseInt(item.querySelector("[data-h-xp]").value) || h.xp;
      const on = [...item.querySelectorAll(".wd.on")].map(b => parseInt(b.dataset.wd));
      h.days = on.length === 7 ? [] : on;   // all days = daily
    });
    saveState(); render(); toast("✅", "Habits saved", "");
  });

  // weekly goals
  on(root, "saveGoals", () => {
    root.querySelectorAll("#goalRows .admin-grid").forEach(rowEl => {
      const g = S.goals.find(x => x.id === rowEl.dataset.id); if (!g) return;
      g.ico = rowEl.querySelector("[data-g-ico]").value.trim() || g.ico;
      g.name = rowEl.querySelector("[data-g-name]").value.trim() || g.name;
      g.target = parseFloat(rowEl.querySelector("[data-g-target]").value) || g.target;
      g.unit = rowEl.querySelector("[data-g-unit]").value.trim();
    });
    saveState(); render(); toast("✅", "Goals saved", "");
  });

  // tasks (+ priority)
  on(root, "saveTasks", () => {
    root.querySelectorAll("#taskRows .admin-row").forEach(rowEl => {
      const t = S.tasks.find(x => x.id === rowEl.dataset.id); if (!t) return;
      t.title = rowEl.querySelector("[data-t-title]").value.trim() || t.title;
      t.priority = rowEl.querySelector("[data-t-prio]").value;
      t.repeat = rowEl.querySelector("[data-t-repeat]").value;
      t.due = rowEl.querySelector("[data-t-due]").value;
    });
    saveState(); render(); toast("✅", "Tasks saved", "");
  });
  on(root, "clearDone", () => { S.tasks = S.tasks.filter(t => !t.done); saveState(); render(); });

  // budgets
  on(root, "addBudgetAdmin", () => {
    const name = val("abName"), limit = num("abLimit", 0); if (!name || !limit) return;
    S.finance.budgets.push({ id: uid(), name, ico: val("abIco") || "•", limit, spent: 0 });
    saveState(); render();
  });
  on(root, "saveBudgets", () => {
    root.querySelectorAll("#budgetRows .admin-grid").forEach(rowEl => {
      const b = S.finance.budgets.find(x => x.id === rowEl.dataset.id); if (!b) return;
      b.ico = rowEl.querySelector("[data-b-ico]").value.trim() || b.ico;
      b.name = rowEl.querySelector("[data-b-name]").value.trim() || b.name;
      b.limit = parseFloat(rowEl.querySelector("[data-b-limit]").value) || b.limit;
      b.spent = parseFloat(rowEl.querySelector("[data-b-spent]").value) || 0;
    });
    saveState(); render(); toast("✅", "Budgets saved", "");
  });

  // health (+ add, direction)
  on(root, "addMetric", () => {
    const name = val("amName"); if (!name) return;
    S.health.metrics.push({ id: uid(), name, ico: val("amIco") || "•", value: num("amValue", 0), goal: num("amGoal", 0), unit: val("amUnit"), dir: document.getElementById("amDir").value });
    saveState(); render();
  });
  on(root, "saveHealth", () => {
    root.querySelectorAll("#metricRows .admin-grid").forEach(rowEl => {
      const m = S.health.metrics.find(x => x.id === rowEl.dataset.id); if (!m) return;
      m.ico = rowEl.querySelector("[data-m-ico]").value.trim() || m.ico;
      m.name = rowEl.querySelector("[data-m-name]").value.trim() || m.name;
      m.value = parseFloat(rowEl.querySelector("[data-m-value]").value) || 0;
      m.goal = parseFloat(rowEl.querySelector("[data-m-goal]").value) || m.goal;
      m.unit = rowEl.querySelector("[data-m-unit]").value.trim();
      m.dir = rowEl.querySelector("[data-m-dir]").value;
    });
    saveState(); render(); toast("✅", "Metrics saved", "");
  });

  // events (+ add, edit)
  on(root, "addEventAdmin", () => {
    const title = val("aeTitle"); if (!title) return;
    S.events.push({ id: uid(), title, date: val("aeDate"), time: val("aeTime"), loc: val("aeLoc") });
    saveState(); render();
  });
  on(root, "saveEvents", () => {
    root.querySelectorAll("#eventRows .admin-grid").forEach(rowEl => {
      const e = S.events.find(x => x.id === rowEl.dataset.id); if (!e) return;
      e.title = rowEl.querySelector("[data-e-title]").value.trim() || e.title;
      e.date = rowEl.querySelector("[data-e-date]").value || e.date;
      e.time = rowEl.querySelector("[data-e-time]").value;
      e.loc = rowEl.querySelector("[data-e-loc]").value.trim();
    });
    saveState(); render(); toast("✅", "Events saved", "");
  });

  // notes (edit)
  on(root, "saveNotes", () => {
    root.querySelectorAll("#noteRows .admin-item").forEach(item => {
      const n = S.notes.find(x => x.id === item.dataset.id); if (!n) return;
      n.body = item.querySelector("[data-n-body]").value;
    });
    saveState(); render(); toast("✅", "Notes saved", "");
  });

  // danger zone
  on(root, "adminExport", () => document.getElementById("exportBtn").click());
  on(root, "wipeAll", async () => {
    if (!confirm("Wipe ALL data and reset to defaults? This cannot be undone.")) return;
    await Store.wipeServer();
    S = structuredClone(SEED);
    saveState();
    switchView("overview");
    toast("🧹", "Wiped", "Everything reset to defaults.");
  });
}

function num(id, fallback) { const v = parseFloat(val(id)); return isNaN(v) ? fallback : v; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function on(root, id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }

/* ---------- View switching ---------- */
function switchView(view) {
  currentView = view;
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  render();
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("themeBtn");
  if (btn) btn.textContent = t === "light" ? "☀️ Theme" : "🌙 Theme";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#f3f5fb" : "#0c0e16");
}
function toggleTheme() {
  const next = (S.settings.theme === "light") ? "dark" : "light";
  S.settings.theme = next;
  applyTheme(next);
  saveState();
}

/* ---------- Reminders (browser notifications for today's events) ---------- */
let reminderTimers = [];
function scheduleReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (!S.settings.remindersEnabled || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const today = todayISO();
  const now = Date.now();
  const LEAD = 5 * 60000; // notify 5 min before
  S.events.filter(e => e.date === today && e.time).forEach(e => {
    const [h, m] = e.time.split(":").map(Number);
    const when = new Date(); when.setHours(h, m, 0, 0);
    const ms = when.getTime() - LEAD - now;
    if (ms > 0 && ms < 24 * 3600000) {
      reminderTimers.push(setTimeout(() => {
        try { new Notification("⏰ " + e.title, { body: e.time + (e.loc ? " · " + e.loc : ""), icon: "icon.svg" }); } catch (_) {}
      }, ms));
    }
  });
}
async function enableReminders() {
  if (typeof Notification === "undefined") { toast("⚠️", "Unsupported", "This browser has no notifications."); return; }
  let perm = Notification.permission;
  if (perm !== "granted") perm = await Notification.requestPermission();
  if (perm === "granted") {
    S.settings.remindersEnabled = true; saveState(); scheduleReminders(); render();
    toast("🔔", "Reminders on", "You'll be nudged before events.");
  } else { toast("⚠️", "Blocked", "Allow notifications in your browser settings."); }
}

/* ---------- Modal + Quick Add + Onboarding ---------- */
let modalDismissable = true;
function openModal(html, { dismissable = true } = {}) {
  modalDismissable = dismissable;
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-overlay" id="modalOverlay"><div class="modal">${html}</div></div>`;
  const overlay = document.getElementById("modalOverlay");
  overlay.addEventListener("click", e => { if (e.target === overlay && modalDismissable) closeModal(); });
  return root.querySelector(".modal");
}
function closeModal() { if (modalDismissable) document.getElementById("modalRoot").innerHTML = ""; }
function forceCloseModal() { document.getElementById("modalRoot").innerHTML = ""; }
function modalOpen() { return document.getElementById("modalRoot").children.length > 0; }

const qaForms = {
  task: () => `<input class="input" id="qaT" placeholder="Task title…">
    <div class="row" style="margin-top:8px">
      <select class="input" id="qaTP"><option value="high">High</option><option value="med" selected>Medium</option><option value="low">Low</option></select>
      <input class="input" id="qaTD" type="date" title="Due date">
    </div>`,
  note: () => `<textarea class="input" id="qaN" rows="4" placeholder="Write a note…"></textarea>`,
  event: () => `<input class="input" id="qaE" placeholder="Event title…">
    <div class="row" style="margin-top:8px"><input class="input" id="qaED" type="date" value="${todayISO()}"><input class="input" id="qaET" type="time" value="09:00"></div>`,
  goal: () => `<input class="input" id="qaG" placeholder="Goal name…">
    <div class="row" style="margin-top:8px"><input class="input" id="qaGT" type="number" placeholder="Target"><input class="input" id="qaGU" placeholder="unit (km, h…)"></div>`,
};
const qaSubmit = {
  task: () => { const v = val("qaT"); if (!v) return false; S.tasks.unshift({ id: uid(), title: v, priority: document.getElementById("qaTP").value, done: false, xp: 10, repeat: "none", due: val("qaTD"), lastDone: "" }); saveState(); toast("✅", "Task added", v); return true; },
  note: () => { const v = document.getElementById("qaN").value.trim(); if (!v) return false; S.notes.push({ id: uid(), date: todayISO(), body: v }); addXP(S.settings.noteXP ?? 5, "Captured a note"); saveState(); toast("📝", "Note saved", ""); return true; },
  event: () => { const v = val("qaE"); if (!v) return false; S.events.push({ id: uid(), title: v, date: val("qaED"), time: val("qaET"), loc: "" }); saveState(); toast("📅", "Event added", v); return true; },
  goal: () => { const v = val("qaG"), t = num("qaGT", 0); if (!v || !t) return false; S.goals.push({ id: uid(), name: v, ico: "🎯", target: t, unit: val("qaGU"), progress: 0, weekStart: mondayISO(), completedAwarded: false }); saveState(); toast("🎯", "Goal added", v); return true; },
};
function openQuickAdd(initial) {
  let type = initial || "task";
  const modal = openModal(`
    <h2>⚡ Quick Add <button class="modal-close" data-close>×</button></h2>
    <div class="seg" id="qaSeg">
      <button data-qa="task">✅ Task</button><button data-qa="note">📝 Note</button>
      <button data-qa="event">📅 Event</button><button data-qa="goal">🎯 Goal</button>
    </div>
    <div id="qaBody"></div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="qaSave">Add</button></div>
  `);
  const renderBody = () => {
    modal.querySelectorAll("[data-qa]").forEach(b => b.classList.toggle("on", b.dataset.qa === type));
    document.getElementById("qaBody").innerHTML = qaForms[type]();
    const f = modal.querySelector("#qaBody input, #qaBody textarea"); if (f) f.focus();
  };
  modal.querySelectorAll("[data-qa]").forEach(b => b.onclick = () => { type = b.dataset.qa; renderBody(); });
  modal.querySelector("[data-close]").onclick = closeModal;
  document.getElementById("qaSave").onclick = () => { if (qaSubmit[type]()) { closeModal(); render(); } };
  modal.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); document.getElementById("qaSave").click(); } });
  renderBody();
}
function openOnboarding() {
  const avatars = ["🧗", "🚀", "🦊", "🌱", "🧠", "⭐", "🐺", "🎯", "🔥", "🦉"];
  let avatar = S.profile.avatar || avatars[0], theme = S.settings.theme || "dark";
  const modal = openModal(`
    <h2>👋 Welcome to Life OS</h2>
    <div class="sub">Let's make it yours — you can change all of this later in Admin.</div>
    <div class="field"><label>Your name</label><input class="input" id="obName" value="${esc(S.profile.name || "")}" placeholder="Your name"></div>
    <div class="field"><label>Pick an avatar</label><div class="avatar-pick" id="obAvatars">
      ${avatars.map((a, i) => `<button data-av="${a}" class="${(S.profile.avatar === a || (i === 0 && !S.profile.avatar)) ? "on" : ""}">${a}</button>`).join("")}
    </div></div>
    <div class="field"><label>Theme</label><div class="seg" id="obTheme">
      <button data-th="dark" class="${theme !== "light" ? "on" : ""}">🌙 Dark</button>
      <button data-th="light" class="${theme === "light" ? "on" : ""}">☀️ Light</button>
    </div></div>
    <button class="btn" id="obStart" style="width:100%;margin-top:6px">Get started →</button>
  `);
  modal.querySelectorAll("[data-av]").forEach(b => b.onclick = () => { avatar = b.dataset.av; modal.querySelectorAll("[data-av]").forEach(x => x.classList.toggle("on", x === b)); });
  modal.querySelectorAll("[data-th]").forEach(b => b.onclick = () => { theme = b.dataset.th; modal.querySelectorAll("[data-th]").forEach(x => x.classList.toggle("on", x === b)); applyTheme(theme); });
  document.getElementById("obStart").onclick = () => {
    S.profile.name = val("obName") || S.profile.name || "Friend";
    S.profile.avatar = avatar; S.settings.theme = theme; S.profile.onboarded = true;
    applyTheme(theme); saveState(); closeModal(); render();
    toast("🎉", "Welcome, " + S.profile.name.split(" ")[0] + "!", "Your dashboard is ready.");
  };
}

/* ---------- Auth screen (multi-user) ---------- */
function showAuth() {
  let mode = "login";
  const openIt = () => {
    const modal = openModal(`
      <h2>${mode === "login" ? "🔐 Log in" : "✨ Create your account"}</h2>
      <div class="sub">Your data is private to your account and stored on the server.</div>
      <div class="field"><label>Username</label><input class="input" id="authUser" autocomplete="username" placeholder="username"></div>
      <div class="field"><label>Password</label><input class="input" id="authPass" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="••••••"></div>
      <div id="authErr" class="down" style="font-size:12px;min-height:16px;margin-bottom:6px"></div>
      <button class="btn" id="authSubmit" style="width:100%">${mode === "login" ? "Log in" : "Create account"}</button>
      <p class="muted" style="font-size:12px;margin-top:12px;text-align:center">
        ${mode === "login" ? "New here?" : "Already have an account?"}
        <a href="#" id="authToggle" style="color:var(--accent-2)">${mode === "login" ? "Create an account" : "Log in"}</a>
      </p>
    `, { dismissable: false });
    modal.querySelector("#authToggle").onclick = e => { e.preventDefault(); mode = mode === "login" ? "register" : "login"; openIt(); };
    const submit = async () => {
      const u = val("authUser"), pw = document.getElementById("authPass").value;
      const errEl = document.getElementById("authErr");
      if (!u || !pw) { errEl.textContent = "Enter a username and password."; return; }
      const r = mode === "login" ? await Store.login(u, pw) : await Store.register(u, pw);
      if (r.ok) { forceCloseModal(); await startApp(); }
      else errEl.textContent = r.error;
    };
    document.getElementById("authSubmit").onclick = submit;
    modal.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    document.getElementById("authUser").focus();
  };
  openIt();
}

/* ---------- App boot ---------- */
async function startApp() {
  S = await Store.load(SEED);
  if (S === null) { showAuth(); return; }   // login required
  normalizeState();
  applyTheme(S.settings.theme);
  checkAchievements();
  render();
  scheduleReminders();
  if (!S.profile.onboarded) openOnboarding();
}

/* ---------- Global controls ---------- */
function bindGlobalControls() {
  window.addEventListener("lifeos:auth-expired", () => {
    toast("🔒", "Session expired", "Please log in again.");
    showAuth();
  });

  document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => switchView(b.dataset.view));
  document.getElementById("themeBtn").onclick = toggleTheme;
  document.getElementById("fab").onclick = () => openQuickAdd();

  // keyboard: N = quick add, Esc = close (dismissable) modal
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModal(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (!typing && !modalOpen() && (e.key === "n" || e.key === "N")) { e.preventDefault(); openQuickAdd(); }
  });

  document.getElementById("exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "life-os-backup-" + todayISO() + ".json";
    a.click();
  };
  document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();
  document.getElementById("importFile").onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { S = JSON.parse(reader.result); normalizeState(); saveState(); render(); toast("✅", "Imported", "Your data was restored."); }
      catch { toast("⚠️", "Import failed", "Invalid file."); }
    };
    reader.readAsText(file);
  };
  document.getElementById("resetBtn").onclick = () => {
    if (confirm("Reset your dashboard to defaults? This erases your saved progress.")) {
      S = structuredClone(SEED); normalizeState(); saveState(); switchView("overview");
    }
  };
}

async function setup() {
  await Store.init();
  bindGlobalControls();
  if (Store.needsAuth()) { showAuth(); return; }   // online + not logged in
  await startApp();
}

document.addEventListener("DOMContentLoaded", setup);
