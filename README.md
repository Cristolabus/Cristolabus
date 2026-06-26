# ⚡ Life OS — Personal Life Dashboard

A gamified dashboard for running your personal life: discipline & consistency
tracking, habits, tasks, calendar, finance, health, and notes — with an XP/level
system, streaks, and achievements to keep you motivated.

## Open it

No build step, no dependencies. Just open `index.html` in your browser:

```bash
# from this folder
xdg-open index.html   # Linux
open index.html       # macOS
# or double-click the file
```

All your data is saved locally in your browser (`localStorage`). Use the
**Export / Import** buttons in the sidebar to back up or move your data.

## What's inside

| Section | What it does |
|---|---|
| 🏠 **Overview** | Daily snapshot: streak, discipline %, level, priority tasks & next events |
| 🔥 **Habits & Discipline** | Check off daily habits, build streaks, 30-day consistency heatmap |
| ✅ **Tasks** | Prioritized to-dos; completing them earns XP |
| 📅 **Calendar** | Upcoming events grouped by day |
| 💰 **Finance** | Monthly budgets with spend tracking and progress bars |
| ❤️ **Health** | Sleep, steps, water, weight vs. goals |
| 📝 **Notes** | Quick journal / scratchpad |
| 🏆 **Achievements** | Unlockable badges for milestones |

## The gamification system

- **XP & Levels** — every habit, task, note, and met goal awards XP. Fill the bar to level up and earn new titles (Novice → Apprentice → … → Legend).
- **Discipline score** — % of today's habits completed. A day counts toward your streak at **60%+**.
- **Streaks** — consecutive qualifying days, shown per-habit and overall.
- **Achievements** — 10 unlockable badges (Perfect Day, Unstoppable, Iron Will, …).

## Connecting real data (Google Calendar, Notion, etc.)

The app is self-contained and offline-first. To pull in **live** data from your
real accounts, a Claude Code session can read your Google Calendar / Notion via
its connected integrations and regenerate the `events` / `tasks` arrays in
`data.js` — then you Import the result. A true always-on live sync would require
hosting an OAuth backend, which is overkill for a personal tool.

## Files

- `index.html` — layout & shell
- `styles.css` — theme & components
- `data.js` — default seed data (first run only)
- `app.js` — gamification engine, views, persistence
