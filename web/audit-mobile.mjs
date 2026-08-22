import { chromium } from "playwright";
const routes = ["/", "/scores", "/standings", "/playoffs", "/teams", "/teams/KC", "/stats",
  "/war", "/separation", "/lab", "/visuals", "/snaps", "/market", "/tools/fourth-down", "/tools/armchair-gm",
  "/players/00-0033873", "/games/2025_22_SEA_NE",
  "/games/2026_01_NE_SEA",
  "/draft",
  "/fantasy",
  "/fantasy/draft",
  "/fantasy/week",
  "/fantasy/week?view=ros",
  "/fantasy/week?view=wire",
  "/fantasy/espn", "/week/2025/10", "/coaches", "/fantasy/league", "/glossary"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let bad = 0;
for (const route of routes) {
  await page.goto(`http://localhost:${process.env.PORT ?? 3000}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, vw: window.innerWidth,
  }));
  const over = m.doc > m.vw + 1;
  if (over) bad++;
  console.log(`${over ? "OVERFLOW" : "   ok   "}  ${String(m.doc).padStart(4)}px  ${route}`);
}
console.log(`\n${bad} of ${routes.length} pages overflow`);
await browser.close();
