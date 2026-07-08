/* ===== Life OS — Application logic ===== */
"use strict";

/* ---------- State management ---------- */
function ensureSettings() {
  if (!S.settings) S.settings = { streakThreshold: 60, noteXP: 5, goalXP: 15 };
}
// Backfill any missing top-level structures so a partial/old saved state
// can never crash the UI.
function normalizeState() {
  if (!S || typeof S !== "object") S = structuredClone(SEED);
  for (const key of ["profile", "log", "habits", "tasks", "events", "finance", "health", "notes", "settings"]) {
    if (S[key] === undefined || S[key] === null) S[key] = structuredClone(SEED[key]);
  }
  if (!S.finance.budgets) S.finance.budgets = [];
  if (!S.health.metrics) S.health.metrics = [];
  if (!S.profile.level) S.profile.level = 1;
  if (S.profile.xp === undefined) S.profile.xp = 0;
  if (!S.profile.name) S.profile.name = "Friend";
  if (!S.profile.avatar) S.profile.avatar = "🧗";
  ensureSettings();
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

/* ---------- Discipline & streaks ---------- */
// Discipline score for a day = % of habits completed.
function dayDisciplinePct(iso) {
  const total = S.habits.length;
  if (!total) return 0;
  const day = S.log[iso];
  if (!day) return 0;
  const done = Object.values(day.habits).filter(Boolean).length;
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

  tasks() {
    const active = S.tasks.filter(t => !t.done);
    const done = S.tasks.filter(t => t.done);
    return `
      <h2 class="section-title">✅ Tasks</h2>
      <div class="card">
        <div class="row">
          <input class="input" id="newTask" placeholder="Add a task…" />
          <select id="newTaskPrio" style="width:auto">
            <option value="high">High</option>
            <option value="med" selected>Medium</option>
            <option value="low">Low</option>
          </select>
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
        </div>
        <p class="muted" style="margin-top:10px;font-size:12px">💡 Tip: a Claude Code session can sync your real Google Calendar into this view.</p>
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
    return `
      <h2 class="section-title">💰 Finance</h2>
      <div class="grid cols-3">
        ${kpi("💵", money(f.monthlyIncome), "Monthly income", "")}
        ${kpi("💸", money(totalSpent), "Spent this month", `of ${money(totalLimit)} budgeted`)}
        ${kpi("🏦", money(remaining), "Remaining", remaining >= 0 ? "<span class='up'>In the green</span>" : "<span class='down'>Over budget</span>")}
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
      <div class="card" style="margin-top:18px"><h2>🔥 Habit consistency — last 30 days</h2>
        ${habitBreak.length ? `<div class="chart-wrap">${Charts.hbars(habitBreak, { color: "#3ddc97" })}</div>` : `<div class="empty">Add some habits to see consistency here.</div>`}
      </div>
    `;
  },

  admin() {
    const online = Store.isOnline();
    const authed = Store.isAuthed();
    const locked = online && !authed;

    let html = `<h2 class="section-title">⚙️ Admin &amp; Settings</h2>`;

    // ---- backend / auth status ----
    html += `<div class="card"><h2>🔌 Backend <span class="h-spacer"></span>
      <span class="badge ${online ? "on" : "off"}">${online ? "Server connected" : "Offline — local only"}</span></h2>`;
    if (online && authed) {
      html += `<div class="row"><p class="muted" style="font-size:13px;flex:1">Admin logged in — every change syncs to the SQLite database.</p>
        <button class="btn sm soft" id="logoutBtn">Log out</button></div>`;
    } else if (online) {
      html += `<div class="login-box">
        <div class="field"><label>Admin password</label><input class="input" id="adminPw" type="password" placeholder="Enter admin password" /></div>
        <button class="btn" id="loginBtn">Log in</button>
        <p class="muted" style="font-size:12px;margin-top:8px">Default is <b>admin</b> (set <code>ADMIN_PASSWORD</code> on the server to change). The dashboard is read-only until you log in.</p>
      </div>`;
    } else {
      html += `<p class="muted" style="font-size:13px">No server detected — you're editing local browser data. Run <code>npm start</code> for database-backed storage with login.</p>`;
    }
    html += `</div>`;

    if (locked) return html + `<div class="empty">🔒 Log in above to manage your data.</div>`;

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

    // ---- habits ----
    html += `<div class="card"><h2>🔥 Manage Habits</h2>
      <div class="admin-grid admin-head"><span></span><span>Name</span><span>Icon</span><span>XP</span><span></span></div>
      <div id="habitRows">` +
      S.habits.map(h => `<div class="admin-grid" data-id="${h.id}">
        <div class="habit-ico">${h.ico}</div>
        <input class="input" data-h-name value="${esc(h.name)}">
        <input class="input mini" data-h-ico value="${esc(h.ico)}">
        <input class="input mini" data-h-xp type="number" value="${h.xp}">
        <button class="icon-btn" data-delhabit="${h.id}" title="Delete">✕</button>
      </div>`).join("") + `</div>
      <div class="row wrap" style="margin-top:12px">
        <input class="input" id="ahName" placeholder="New habit name" style="flex:1;min-width:140px">
        <input class="input" id="ahIco" placeholder="✨" style="width:70px">
        <input class="input" id="ahXp" type="number" placeholder="XP" style="width:80px">
        <button class="btn soft" id="addHabitAdmin">Add</button>
        <button class="btn" id="saveHabits">Save all</button>
      </div>
    </div>`;

    // ---- tasks ----
    html += `<div class="card"><h2>✅ Manage Tasks</h2>` +
      (S.tasks.length ? S.tasks.map(t => `<div class="admin-row" data-id="${t.id}">
        <div>${t.done ? "✅" : "⬜"}</div>
        <input class="input" data-t-title value="${esc(t.title)}">
        <button class="icon-btn" data-deltask="${t.id}">✕</button>
      </div>`).join("") : `<div class="empty">No tasks.</div>`) +
      `<div class="row" style="margin-top:12px"><button class="btn soft" id="clearDone">Clear completed</button><button class="btn" id="saveTasks">Save titles</button></div>
    </div>`;

    // ---- budgets ----
    html += `<div class="card"><h2>💰 Manage Budgets</h2>
      <div class="admin-grid admin-head"><span></span><span>Category</span><span>Limit</span><span>Spent</span><span></span></div>` +
      S.finance.budgets.map(b => `<div class="admin-grid" data-id="${b.id}">
        <input class="input mini" data-b-ico value="${esc(b.ico || "")}" style="width:48px">
        <input class="input" data-b-name value="${esc(b.name)}">
        <input class="input mini" data-b-limit type="number" value="${b.limit}">
        <input class="input mini" data-b-spent type="number" value="${b.spent}">
        <button class="icon-btn" data-delbudget="${b.id}">✕</button>
      </div>`).join("") +
      `<button class="btn" id="saveBudgets" style="margin-top:12px">Save budgets</button>
    </div>`;

    // ---- health ----
    html += `<div class="card"><h2>❤️ Manage Health Metrics</h2>` +
      S.health.metrics.map(m => `<div class="admin-grid" data-id="${m.id}" style="grid-template-columns:48px 1.4fr 70px 70px 60px auto">
        <input class="input mini" data-m-ico value="${esc(m.ico || "")}" style="width:48px">
        <input class="input" data-m-name value="${esc(m.name)}">
        <input class="input mini" data-m-value type="number" value="${m.value}">
        <input class="input mini" data-m-goal type="number" value="${m.goal}">
        <input class="input mini" data-m-unit value="${esc(m.unit || "")}" style="width:50px">
        <button class="icon-btn" data-delmetric="${m.id}">✕</button>
      </div>`).join("") +
      `<button class="btn" id="saveHealth" style="margin-top:12px">Save metrics</button>
    </div>`;

    // ---- events ----
    html += `<div class="card"><h2>📅 Manage Events</h2>` +
      (S.events.length ? S.events.map(e => `<div class="admin-row" data-id="${e.id}">
        <div>📅</div>
        <div><b>${esc(e.title)}</b> <span class="muted">${e.date} ${e.time || ""}</span></div>
        <button class="icon-btn" data-delevent="${e.id}">✕</button>
      </div>`).join("") : `<div class="empty">No events.</div>`) + `</div>`;

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
  const day = ensureDay(todayISO());
  return S.habits.map(h => {
    const done = !!day.habits[h.id];
    const st = habitStreak(h.id);
    return `<div class="habit">
      <div class="habit-ico">${h.ico}</div>
      <div>
        <div class="habit-name">${esc(h.name)}</div>
        ${compact ? "" : `<div class="habit-meta">+${h.xp} XP · daily</div>`}
      </div>
      <div class="streak-chip">${st > 0 ? "🔥 " + st : ""}</div>
      <button class="check ${done ? "done" : ""}" data-habit="${h.id}">✓</button>
      ${compact ? "" : `<button class="icon-btn" data-delhabit="${h.id}" title="Delete habit">✕</button>`}
    </div>`;
  }).join("");
}
function habitStreak(id) {
  let streak = 0, d = new Date();
  if (!(S.log[isoOf(d)]?.habits?.[id])) d.setDate(d.getDate() - 1);
  while (S.log[isoOf(d)]?.habits?.[id]) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function taskHTML(t) {
  return `<div class="task ${t.done ? "done" : ""}">
    <button class="check ${t.done ? "done" : ""}" data-task="${t.id}">✓</button>
    <span class="task-title">${esc(t.title)}</span>
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
    if (t.done) { addXP(t.xp || 10, "Task: " + t.title); S.profile.tasksDone = (S.profile.tasksDone || 0) + 1; }
    else { removeXP(t.xp || 10); S.profile.tasksDone = Math.max(0, (S.profile.tasksDone || 0) - 1); }
    saveState(); checkAchievements(); render();
  });
  root.querySelectorAll("[data-deltask]").forEach(b => b.onclick = () => {
    S.tasks = S.tasks.filter(t => t.id !== b.dataset.deltask); saveState(); render();
  });
  on(root, "addTask", () => {
    const v = val("newTask"); if (!v) return;
    S.tasks.unshift({ id: uid(), title: v, priority: document.getElementById("newTaskPrio").value, done: false, xp: 10 });
    saveState(); render();
  });

  // events
  on(root, "addEvent", () => {
    const title = val("evTitle"); if (!title) return;
    S.events.push({ id: uid(), title, date: val("evDate"), time: val("evTime"), loc: val("evLoc") });
    saveState(); render();
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

  if (currentView === "admin") bindAdmin(root);
}

/* ---------- Admin panel bindings ---------- */
function bindAdmin(root) {
  // auth
  on(root, "loginBtn", async () => {
    const pw = val("adminPw");
    const r = await Store.login(pw);
    if (r.ok) { toast("🔓", "Logged in", "Changes now sync to the database."); await Store.pushNow(S); render(); }
    else toast("⚠️", "Login failed", r.error || "Wrong password");
  });
  on(root, "logoutBtn", () => { Store.logout(); toast("🔒", "Logged out", "Editing is now read-only."); render(); });

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
    saveState(); render(); toast("✅", "Settings saved", "");
  });

  // habits
  on(root, "addHabitAdmin", () => {
    const name = val("ahName"); if (!name) return;
    S.habits.push({ id: uid(), name, ico: val("ahIco") || "✨", xp: num("ahXp", 10), cadence: "daily" });
    saveState(); render();
  });
  on(root, "saveHabits", () => {
    root.querySelectorAll("#habitRows .admin-grid").forEach(rowEl => {
      const h = S.habits.find(x => x.id === rowEl.dataset.id); if (!h) return;
      h.name = rowEl.querySelector("[data-h-name]").value.trim() || h.name;
      h.ico = rowEl.querySelector("[data-h-ico]").value.trim() || h.ico;
      h.xp = parseInt(rowEl.querySelector("[data-h-xp]").value) || h.xp;
    });
    saveState(); render(); toast("✅", "Habits saved", "");
  });

  // tasks
  on(root, "saveTasks", () => {
    root.querySelectorAll(".admin-row[data-id]").forEach(rowEl => {
      const inp = rowEl.querySelector("[data-t-title]"); if (!inp) return;
      const t = S.tasks.find(x => x.id === rowEl.dataset.id);
      if (t) t.title = inp.value.trim() || t.title;
    });
    saveState(); render(); toast("✅", "Tasks saved", "");
  });
  on(root, "clearDone", () => { S.tasks = S.tasks.filter(t => !t.done); saveState(); render(); });

  // budgets
  on(root, "saveBudgets", () => {
    root.querySelectorAll(".admin-grid[data-id]").forEach(rowEl => {
      const b = S.finance.budgets.find(x => x.id === rowEl.dataset.id); if (!b) return;
      const name = rowEl.querySelector("[data-b-name]"); if (!name) return;
      b.ico = rowEl.querySelector("[data-b-ico]").value.trim() || b.ico;
      b.name = name.value.trim() || b.name;
      b.limit = parseFloat(rowEl.querySelector("[data-b-limit]").value) || b.limit;
      b.spent = parseFloat(rowEl.querySelector("[data-b-spent]").value) || 0;
    });
    saveState(); render(); toast("✅", "Budgets saved", "");
  });

  // health
  on(root, "saveHealth", () => {
    root.querySelectorAll(".admin-grid[data-id]").forEach(rowEl => {
      const m = S.health.metrics.find(x => x.id === rowEl.dataset.id); if (!m) return;
      const nameEl = rowEl.querySelector("[data-m-name]"); if (!nameEl) return;
      m.ico = rowEl.querySelector("[data-m-ico]").value.trim() || m.ico;
      m.name = nameEl.value.trim() || m.name;
      m.value = parseFloat(rowEl.querySelector("[data-m-value]").value) || 0;
      m.goal = parseFloat(rowEl.querySelector("[data-m-goal]").value) || m.goal;
      m.unit = rowEl.querySelector("[data-m-unit]").value.trim();
    });
    saveState(); render(); toast("✅", "Metrics saved", "");
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

/* ---------- Global controls ---------- */
async function setup() {
  await Store.init();
  S = await Store.load(SEED);
  normalizeState();

  window.addEventListener("lifeos:auth-expired", () => {
    toast("🔒", "Session expired", "Log in again to keep syncing.");
    if (currentView === "admin") render();
  });

  document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => switchView(b.dataset.view));

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
      try { S = JSON.parse(reader.result); saveState(); render(); toast("✅", "Imported", "Your data was restored."); }
      catch { toast("⚠️", "Import failed", "Invalid file."); }
    };
    reader.readAsText(file);
  };
  document.getElementById("resetBtn").onclick = () => {
    if (confirm("Reset everything to defaults? This erases your saved progress.")) {
      S = structuredClone(SEED); saveState(); switchView("overview");
    }
  };

  checkAchievements();
  render();
}

document.addEventListener("DOMContentLoaded", setup);
