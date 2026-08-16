import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } });
for (const [route, name] of [["/war","war"],["/players/00-0033873","player-war"]]) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `../shots/${name}.png` });
  console.log("shot", route);
}
await browser.close();
