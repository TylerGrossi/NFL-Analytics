import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
for (const [route, name] of [
  ["/stats?mode=teams&cat=line&season=2025","stats-line"],
  ["/playoffs","playoffs"],
]) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `../shots/${name}.png` });
  console.log("shot", route);
}
await browser.close();
