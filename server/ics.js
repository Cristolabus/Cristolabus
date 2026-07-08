/* ===== Life OS — minimal iCalendar (.ics) parser =====
 * Parses VEVENTs from an ICS feed (e.g. a Google Calendar "secret address in
 * iCal format") into the dashboard's event shape:
 *   { id, title, date: "YYYY-MM-DD", time: "HH:MM"|"", loc, source: "ics" }
 * Handles RFC 5545 line folding, DATE and DATE-TIME DTSTART, and escaping.
 */

// Unfold folded lines: a line beginning with a space/tab continues the prior.
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescape(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// DTSTART variants:
//   DTSTART;VALUE=DATE:20260710                  -> all-day
//   DTSTART:20260710T130000Z                     -> UTC datetime
//   DTSTART;TZID=America/Santiago:20260710T130000 -> local datetime
function parseDate(rawKey, rawVal) {
  const isDateOnly = /VALUE=DATE(?![-])/i.test(rawKey) || /^\d{8}$/.test(rawVal);
  const m = rawVal.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  let date = `${y}-${mo}-${d}`;
  let time = "";
  if (!isDateOnly && hh != null) {
    if (z === "Z") {
      // Convert UTC to local wall-clock.
      const dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, 0));
      date = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    } else {
      time = `${hh}:${mm}`;
    }
  }
  return { date, time };
}
function pad(n) { return String(n).padStart(2, "0"); }

function parseICS(text) {
  const lines = unfold(String(text)).split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === "BEGIN:VEVENT") { cur = {}; continue; }
    if (t === "END:VEVENT") {
      if (cur && cur._start) {
        const d = cur._start;
        events.push({
          id: "ics_" + (cur.uid || (d.date + (d.time || "") + (cur.summary || ""))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40),
          title: cur.summary || "(untitled)",
          date: d.date,
          time: d.time || "",
          loc: cur.location || "",
          source: "ics",
        });
      }
      cur = null; continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx);
    const val = line.slice(idx + 1).trim();
    const name = key.split(";")[0].toUpperCase();
    if (name === "SUMMARY") cur.summary = unescape(val);
    else if (name === "LOCATION") cur.location = unescape(val);
    else if (name === "UID") cur.uid = val;
    else if (name === "DTSTART") cur._start = parseDate(key, val);
  }
  return events;
}

module.exports = { parseICS };
