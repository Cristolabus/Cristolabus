# ⚡ Life OS — Personal Life Dashboard

A gamified dashboard for running your personal life: discipline & consistency
tracking, habits, tasks, calendar, finance, health, and notes — with an XP/level
system, streaks, achievements, an **Admin panel** for full control, and an
optional **Node + SQLite backend** so your data lives on a server, not just one
browser. It's a **PWA** (installable on your phone, works offline) with **light
and dark themes**.

## Two ways to run it

### 1. Quick & offline (no install)

Just open the file — data is saved in your browser (`localStorage`):

```bash
xdg-open public/index.html   # Linux
open public/index.html       # macOS
# or double-click public/index.html
```

In offline mode the Admin panel needs no login.

**Install as an app:** when served over http (server or Docker mode), open it in
Chrome/Edge/Safari and choose *Install* / *Add to Home Screen*. It runs
full-screen and works offline thanks to the service worker. Toggle **light/dark**
with the Theme button in the sidebar.

### 2. With the server + database (recommended)

Stores everything in a SQLite database and protects edits with an admin login.

```bash
npm install
npm start
# open http://localhost:3000
```

Configure with environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to serve on |
| `ADMIN_PASSWORD` | `admin` | Password for the Admin panel login |
| `LIFEOS_DATA_DIR` | `./data` | Where the SQLite file is stored |

```bash
ADMIN_PASSWORD=mySecret PORT=8080 npm start
```

The app auto-detects which mode it's in and shows the status in **Admin → Backend**.

### 3. Docker

```bash
docker build -t life-os .
docker run -p 3000:3000 -v life-os-data:/data -e ADMIN_PASSWORD=mySecret life-os
# open http://localhost:3000  (database persists in the life-os-data volume)
```

## What's inside

| Section | What it does |
|---|---|
| 🏠 **Overview** | Daily snapshot: streak, discipline %, level, priority tasks, next events, and a daily mood & energy check-in |
| 🔥 **Habits & Discipline** | Check off habits (daily or specific weekdays), build streaks, 30-day consistency heatmap, inline delete |
| 🎯 **Weekly Goals** | Set weekly targets (e.g. 4 workouts), track progress with +/−, auto-reset every Monday, XP on completion |
| ✅ **Tasks** | Prioritized to-dos with **due dates** and **recurring** (daily/weekly) tasks that auto-reopen; completing them earns XP |
| 📅 **Calendar** | Upcoming events grouped by day; one-click **Google Calendar sync** (server mode) |
| 💰 **Finance** | Monthly budgets with spend tracking, progress bars, and a spending-by-category chart |
| ❤️ **Health** | Sleep, steps, water, weight vs. goals |
| 📝 **Notes** | Quick journal / scratchpad |
| 📊 **Analytics** | Charts: XP per day, discipline trend, mood & energy trend, and 30-day habit consistency |
| 🏆 **Achievements** | Unlockable badges for milestones |
| ⚙️ **Admin** | Login, edit profile/currency/income, tune XP rules & streak threshold, full add/edit/delete for habits (incl. weekday cadence), weekly goals, tasks (incl. priority), budgets, health metrics (incl. direction), events & notes, export backup, wipe & reset |

## The gamification system

- **XP & Levels** — every habit, task, note, and met goal awards XP. Fill the bar to level up and earn new titles (Novice → Apprentice → … → Legend). All XP values are editable in Admin.
- **Discipline score** — % of today's habits completed. The threshold a day needs to count toward your streak is configurable (default **60%**).
- **Streaks** — consecutive qualifying days, shown per-habit and overall.
- **Achievements** — 10 unlockable badges (Perfect Day, Unstoppable, Iron Will, …).

## REST API (server mode)

| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | — | `{ ok, hasState }` |
| `POST` | `/api/login` | — | Body `{ password }` → `{ token }` |
| `GET` | `/api/state` | — | Full dashboard state (`204` if none yet) |
| `PUT` | `/api/state` | Bearer | Save full state |
| `DELETE` | `/api/state` | Bearer | Wipe state |
| `POST` | `/api/collection/:name` | Bearer | Create one item in a collection (id auto-assigned) |
| `PUT` | `/api/collection/:name/:id` | Bearer | Modify fields of one item |
| `DELETE` | `/api/collection/:name/:id` | Bearer | Delete one item |

`:name` is one of `habits`, `tasks`, `events`, `notes`, `goals`, `budgets`, `metrics` — giving every
entity a real create / modify / delete endpoint for scripting and automation.

| `POST` | `/api/sync/calendar` | Bearer | Fetch the saved private iCal URL and merge events (Google Calendar sync) |

## Google Calendar sync

In **Admin → Google Calendar Sync**, paste your calendar's **private iCal URL**
(Google Calendar → *Settings → Settings for my calendars → Integrate calendar →
Secret address in iCal format*) and hit **Sync now** (or **Sync Google** on the
Calendar view). The server fetches and parses the feed, replacing previously-synced
events while keeping ones you added by hand. Requires server mode + login.

## Reminders

In **Admin → Reminders**, enable browser notifications to get a nudge 5 minutes
before each of today's timed events (while the dashboard is open).

The frontend caches to `localStorage` too, and flushes any pending change on page-hide, so a brief
server hiccup or a quick reload never loses data.

## Files

```
server/
  index.js     Express server + REST API + static hosting
  db.js        SQLite persistence (better-sqlite3)
  ics.js       iCalendar (.ics) parser for Google Calendar sync
public/
  index.html   layout & shell
  styles.css   theme & components
  data.js      default seed data (first run only)
  store.js     storage/sync layer (server ↔ localStorage)
  charts.js    dependency-free inline-SVG charts (theme-aware)
  app.js       gamification engine, views, Admin panel, theme
  manifest.webmanifest  PWA manifest
  sw.js        service worker (offline app shell)
  icon.svg     app icon
Dockerfile     container image (Node + SQLite)
```

## Connecting real data (Google Calendar, Notion, etc.)

A Claude Code session can read your Google Calendar / Notion via its connected
integrations and regenerate the seed `events` / `tasks` — then Import them, or
have it `PUT` straight to `/api/state`.
