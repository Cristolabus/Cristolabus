/* ===== Life OS — Storage & sync layer =====
 * Two modes, auto-detected:
 *   • Server mode  — served by the Node backend. Multi-user: each account has
 *                    its own private state in SQLite. A bearer token identifies
 *                    the logged-in user. State is NOT cached to localStorage in
 *                    this mode, so accounts never leak on a shared browser.
 *   • Offline mode — opened as a file:// with no backend. Single local profile
 *                    in localStorage, no accounts needed.
 */
const Store = (() => {
  const LS_KEY = "lifeos.state";
  const TOKEN_KEY = "lifeos.token";
  const USER_KEY = "lifeos.username";
  let online = false;
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let username = localStorage.getItem(USER_KEY) || null;
  let saveTimer = null;
  let pendingState = null;

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(path, Object.assign({}, opts, { headers }));
  }

  async function init() {
    try { online = (await fetch("/api/health")).ok; } catch { online = false; }
    // Flush pending debounced save before the page unloads (keepalive).
    const flush = () => {
      if (!online || !token || !pendingState) return;
      try {
        fetch("/api/state", {
          method: "PUT", keepalive: true,
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify(pendingState),
        });
        pendingState = null;
      } catch { /* best effort */ }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    return online;
  }

  function isOnline() { return online; }
  function isAuthed() { return online ? !!token : true; }   // offline = no auth needed
  function needsAuth() { return online && !token; }          // show the login screen
  function getUsername() { return username; }

  async function health() {
    try { return await (await fetch("/api/health")).json(); } catch { return { ok: false }; }
  }

  async function authCall(kind, user, pass) {
    const res = await api("/api/" + kind, { method: "POST", body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "Failed" };
    token = data.token; username = data.username;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    return { ok: true, username };
  }
  const login = (user, pass) => authCall("login", user, pass);
  const register = (user, pass) => authCall("register", user, pass);

  function logout() {
    if (online && token) { try { api("/api/logout", { method: "POST" }); } catch { /* best effort */ } }
    token = null; username = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(LS_KEY);   // drop cached state so nothing leaks
  }

  // Load this user's state. Returns the state object, or null if a login is
  // required (online but no token). New accounts (204) get the seed.
  async function load(seed) {
    if (online) {
      if (!token) return null;
      try {
        const res = await api("/api/state");
        if (res.status === 200) return await res.json();
        if (res.status === 204) return structuredClone(seed);   // fresh account
        if (res.status === 401) { logout(); return null; }
      } catch { /* fall through to offline cache */ }
    }
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { try { return JSON.parse(raw); } catch {} }
    return structuredClone(seed);
  }

  // Save. Online: push to the server (debounced), never to localStorage (avoids
  // cross-account leakage). Offline: cache to localStorage.
  function save(state) {
    if (online && token) {
      pendingState = state;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => pushNow(state), 600);
    } else if (!online) {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    }
  }

  async function pushNow(state) {
    pendingState = null;
    try {
      const res = await api("/api/state", { method: "PUT", body: JSON.stringify(state) });
      if (res.status === 401) { logout(); window.dispatchEvent(new Event("lifeos:auth-expired")); }
    } catch { /* transient — will retry on next save */ }
  }

  async function syncCalendar(url) {
    if (!online) return { ok: false, error: "Calendar sync needs the server running." };
    if (!token) return { ok: false, error: "Log in first to sync." };
    try {
      const res = await api("/api/sync/calendar", { method: "POST", body: JSON.stringify({ url: url || undefined }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "Sync failed" };
      return Object.assign({ ok: true }, data);
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async function wipeServer() {
    if (online && token) { try { await api("/api/state", { method: "DELETE" }); } catch {} }
    localStorage.removeItem(LS_KEY);
  }

  return {
    init, isOnline, isAuthed, needsAuth, getUsername, health,
    login, register, logout, load, save, pushNow, wipeServer, syncCalendar,
  };
})();
