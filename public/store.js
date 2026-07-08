/* ===== Life OS — Storage & sync layer =====
 * Works in two modes automatically:
 *   • Server mode  — when served by the Node backend, state lives in SQLite.
 *                    Writes require admin login (bearer token).
 *   • Offline mode — when opened directly as a file:// , falls back to
 *                    localStorage. Admin editing is always allowed offline.
 */
const Store = (() => {
  const LS_KEY = "lifeos.state";
  const TOKEN_KEY = "lifeos.token";
  let online = false;          // is the backend reachable?
  let token = localStorage.getItem(TOKEN_KEY) || null;
  let saveTimer = null;
  let pendingState = null;   // last unsynced state, flushed on page hide

  async function api(path, opts = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    return res;
  }

  async function init() {
    try {
      const res = await fetch("/api/health");
      online = res.ok;
    } catch { online = false; }
    // Flush any pending debounced save before the page goes away, so the last
    // edit is never lost on reload/close. keepalive lets it complete post-unload.
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
  function isAuthed() { return !online || !!token; }   // offline = always allowed

  async function login(password) {
    if (!online) return { ok: true };                  // no auth needed offline
    const res = await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    if (!res.ok) { const e = await res.json().catch(() => ({})); return { ok: false, error: e.error || "Login failed" }; }
    const data = await res.json();
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    return { ok: true };
  }

  function logout() { token = null; localStorage.removeItem(TOKEN_KEY); }

  // Load state: server first (if online), then localStorage, then seed.
  async function load(seed) {
    if (online) {
      try {
        const res = await api("/api/state");
        if (res.status === 200) return await res.json();
        // 204 = server has no state yet; seed it below from local or defaults.
      } catch { /* fall through */ }
    }
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { try { return JSON.parse(raw); } catch {} }
    return structuredClone(seed);
  }

  // Save: always cache to localStorage; debounce-push to server when authed.
  function save(state) {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    if (online && token) {
      pendingState = state;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => pushNow(state), 600);
    }
  }

  async function pushNow(state) {
    pendingState = null;
    try {
      const res = await api("/api/state", { method: "PUT", body: JSON.stringify(state) });
      if (res.status === 401) { logout(); window.dispatchEvent(new Event("lifeos:auth-expired")); }
    } catch { /* offline blip — localStorage still has it */ }
  }

  async function wipeServer() {
    if (online && token) { try { await api("/api/state", { method: "DELETE" }); } catch {} }
    localStorage.removeItem(LS_KEY);
  }

  return { init, isOnline, isAuthed, login, logout, load, save, pushNow, wipeServer };
})();
