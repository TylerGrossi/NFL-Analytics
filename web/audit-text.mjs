/**
 * Layout audit — the companion to audit-mobile.mjs.
 *
 * Two regressions this guards against, both of which made the site read as
 * templated before they were measured:
 *
 *   1. Prose creeping back above the data. Reports the words a reader actually
 *      meets (`visible`), the words tucked into a collapsed <details> where
 *      they belong (`hidden`), and how far down the first table or chart sits
 *      (`dataTop`). Targets: under ~25 visible words, dataTop under ~450px.
 *
 *   2. Column voids. A two-track grid whose columns differ by hundreds of
 *      pixels leaves a hole in the middle of the page. A long reference table
 *      wants an internal scroll cap; a short sidebar beside a long table wants
 *      `lg:sticky`.
 *
 * Usage: node audit-text.mjs          (expects the dev server on :3000)
 *        PORT=3111 node audit-text.mjs
 */
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3000";

const routes = ["/", "/scores", "/standings", "/playoffs", "/teams", "/teams/KC", "/stats",
  "/war", "/separation", "/lab", "/visuals", "/snaps", "/market", "/tools/fourth-down", "/tools/armchair-gm",
  "/players/00-0033873", "/games/2025_22_SEA_NE", "/draft", "/fantasy",
  "/fantasy/draft", "/fantasy/week", "/fantasy/espn", "/week/2025/10", "/coaches", "/fantasy/league", "/glossary"];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const rows = [];
const voids = [];

for (const route of routes) {
  await p.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle", timeout: 120000 });

  const m = await p.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const words = (el) => (el.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
    const all = [...main.querySelectorAll("p, li")].filter(
      (el) => !el.closest("table") && !el.closest("nav")
    );
    // Collapsed <details> content is in the DOM but not in the reader's way.
    const prose = all.filter((el) => {
      const d = el.closest("details");
      return !d || d.open;
    });
    const firstData = main.querySelector("table, svg");
    return {
      proseWords: prose.reduce((s, el) => s + words(el), 0),
      hidden: all.length - prose.length,
      dataTop: firstData
        ? Math.round(firstData.getBoundingClientRect().top + window.scrollY)
        : null,
      height: Math.round(document.documentElement.scrollHeight),
    };
  });
  rows.push({ route, ...m });

  const found = await p.evaluate(() => {
    const out = [];
    for (const g of document.querySelectorAll("main .grid, main div[class*='grid-cols']")) {
      const cs = getComputedStyle(g);
      if (cs.display !== "grid") continue;
      if (cs.gridTemplateColumns.split(" ").filter(Boolean).length < 2) continue;
      const kids = [...g.children].filter((c) => c.getBoundingClientRect().height > 0);
      if (kids.length < 2 || kids.length > 4) continue;
      // A sticky column follows the reader down, so its track is never read
      // as empty however much taller its neighbor is.
      if (kids.some((c) => getComputedStyle(c).position === "sticky")) continue;
      const hs = kids.map((c) => Math.round(c.getBoundingClientRect().height));
      const gap = Math.max(...hs) - Math.min(...hs);
      if (gap >= 260 && Math.max(...hs) >= 500) {
        out.push({
          gap,
          heights: hs,
          label: (g.querySelector("h2,h3")?.textContent ?? g.className.slice(0, 40))
            .trim()
            .slice(0, 40),
        });
      }
    }
    return out;
  });
  for (const v of found) voids.push({ route, ...v });
}

rows.sort((a, b) => b.proseWords - a.proseWords);
console.log("route".padEnd(26), "visible", "hidden", "dataTop", "height");
for (const r of rows) {
  console.log(
    r.route.padEnd(26),
    String(r.proseWords).padStart(7),
    String(r.hidden).padStart(6),
    String(r.dataTop ?? "-").padStart(7),
    String(r.height).padStart(6)
  );
}
console.log("\nVisible prose across all routes:", rows.reduce((s, r) => s + r.proseWords, 0));

voids.sort((a, b) => b.gap - a.gap);
console.log(`\nColumn voids >= 260px: ${voids.length}`);
for (const v of voids) {
  console.log(`  ${String(v.gap).padStart(5)}px  [${v.heights.join(", ")}]  ${v.route} — ${v.label}`);
}

await b.close();
