/* ===== Life OS — Inline SVG charts =====
 * Dependency-free, offline/CSP-safe. Each chart is a single series, so color
 * carries no categorical meaning — it's just the app accent. Hover tooltips are
 * wired by app.js via [data-tip] attributes and a shared #chartTip element.
 */
const Charts = (() => {
  // Read theme colors live so charts adapt to light/dark.
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  const theme = () => ({
    TXT: cssVar("--muted", "#8b91a8"),
    GRID: cssVar("--border", "#262c40"),
    INK: cssVar("--text", "#e7eaf3"),
  });

  function niceMax(v) {
    if (v <= 0) return 10;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  // Vertical bar chart. series: [{label, value, tip}]
  function bar(series, { color = "#7c5cff", h = 180, unit = "" } = {}) {
    const { TXT, GRID } = theme();
    const w = Math.max(series.length * 34, 320);
    const padL = 34, padB = 26, padT = 10;
    const max = niceMax(Math.max(1, ...series.map(s => s.value)));
    const plotH = h - padB - padT, plotW = w - padL - 8;
    const bw = Math.min(22, (plotW / series.length) * 0.6);
    const gap = plotW / series.length;

    let grid = "", ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const val = (max / ticks) * i;
      const y = padT + plotH - (val / max) * plotH;
      grid += `<line x1="${padL}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${TXT}">${fmtNum(val)}</text>`;
    }
    let bars = "";
    series.forEach((s, i) => {
      const bh = (s.value / max) * plotH;
      const x = padL + gap * i + (gap - bw) / 2;
      const y = padT + plotH - bh;
      bars += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0, bh)}" rx="4" fill="${color}"
        data-tip="${esc(s.tip || (s.label + ": " + s.value + unit))}" class="ch-bar"/>`;
      if (i % Math.ceil(series.length / 7) === 0)
        bars += `<text x="${x + bw / 2}" y="${h - 8}" text-anchor="middle" font-size="9" fill="${TXT}">${esc(s.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMinYMin meet" role="img">${grid}${bars}</svg>`;
  }

  // Line + area chart. series: [{label, value, tip}]
  function line(series, { color = "#4dd6ff", h = 180, unit = "", max: fixedMax } = {}) {
    const { TXT, GRID } = theme();
    const w = Math.max(series.length * 34, 320);
    const padL = 34, padB = 26, padT = 10;
    const max = fixedMax || niceMax(Math.max(1, ...series.map(s => s.value)));
    const plotH = h - padB - padT, plotW = w - padL - 8;
    const xOf = i => padL + (plotW / Math.max(1, series.length - 1)) * i;
    const yOf = v => padT + plotH - (v / max) * plotH;

    let grid = "", ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const val = (max / ticks) * i;
      const y = yOf(val);
      grid += `<line x1="${padL}" y1="${y}" x2="${w - 8}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${TXT}">${fmtNum(val)}${unit}</text>`;
    }
    const pts = series.map((s, i) => `${xOf(i)},${yOf(s.value)}`).join(" ");
    const area = `${padL},${padT + plotH} ${pts} ${xOf(series.length - 1)},${padT + plotH}`;
    let dots = "", labels = "";
    series.forEach((s, i) => {
      dots += `<circle cx="${xOf(i)}" cy="${yOf(s.value)}" r="8" fill="transparent"
        data-tip="${esc(s.tip || (s.label + ": " + s.value + unit))}" class="ch-dot-hit"/>`;
      dots += `<circle cx="${xOf(i)}" cy="${yOf(s.value)}" r="3" fill="${color}"/>`;
      if (i % Math.ceil(series.length / 7) === 0)
        labels += `<text x="${xOf(i)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="${TXT}">${esc(s.label)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMinYMin meet" role="img">
      ${grid}
      <polygon points="${area}" fill="${color}" opacity="0.12"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${labels}
    </svg>`;
  }

  // Horizontal bars with direct labels. series: [{label, value, tip}] (value 0..100)
  function hbars(series, { color = "#3ddc97", unit = "%" } = {}) {
    const { TXT, GRID, INK } = theme();
    const rowH = 30, w = 480, padL = 4, labelW = 150, valW = 44;
    const barMax = w - labelW - valW - padL;
    let rows = "";
    series.forEach((s, i) => {
      const y = i * rowH;
      const bw = (Math.min(100, s.value) / 100) * barMax;
      rows += `<text x="${padL}" y="${y + rowH / 2 + 4}" font-size="12" fill="${INK}">${esc(s.label)}</text>`;
      rows += `<rect x="${labelW}" y="${y + 7}" width="${barMax}" height="${rowH - 16}" rx="4" fill="${GRID}"/>`;
      rows += `<rect x="${labelW}" y="${y + 7}" width="${Math.max(0, bw)}" height="${rowH - 16}" rx="4" fill="${color}"
        data-tip="${esc(s.tip || (s.label + ": " + s.value + unit))}" class="ch-bar"/>`;
      rows += `<text x="${w - 2}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="11" fill="${TXT}">${s.value}${unit}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${series.length * rowH}" width="100%" height="${series.length * rowH}" preserveAspectRatio="xMinYMin meet" role="img">${rows}</svg>`;
  }

  function fmtNum(v) {
    if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
    return Math.round(v);
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  return { bar, line, hbars };
})();
