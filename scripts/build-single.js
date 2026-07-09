#!/usr/bin/env node
/* Build a single self-contained life-os.html by inlining all CSS and JS from
 * public/. The result works offline (no server) — just open it in a browser.
 * Usage: npm run build   →   ./life-os.html
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUB = path.join(ROOT, "public");
const read = f => fs.readFileSync(path.join(PUB, f), "utf8");

let html = read("index.html");
const css = read("styles.css");
const js = ["store.js", "charts.js", "data.js", "app.js"].map(read).join("\n\n");

html = html.replace(/<link rel="stylesheet" href="styles.css"\s*\/>/, `<style>\n${css}\n</style>`);
html = html.replace(/<link rel="manifest"[^>]*>\s*/, "");
html = html.replace(/<link rel="preconnect"[^>]*>\s*/, "");
html = html.replace(
  /<script src="store.js"><\/script>\s*<script src="charts.js"><\/script>\s*<script src="data.js"><\/script>\s*<script src="app.js"><\/script>/,
  `<script>\n${js}\n</script>`
);
html = html.replace(/<script>\s*if \("serviceWorker"[\s\S]*?<\/script>/, "");

const out = path.join(ROOT, "life-os.html");
fs.writeFileSync(out, html);

const leftover = (html.match(/src="[^"]+\.js"|href="[^"]+\.css"|href="manifest/g) || []);
if (leftover.length) { console.error("External refs remain:", leftover); process.exit(1); }
console.log(`Built ${out} (${(html.length / 1024).toFixed(0)}KB, self-contained).`);
