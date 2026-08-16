import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1150 } });
for (const [route, name] of [["/playoffs","playoffs"],["/tools/armchair-gm","armchair-gm"]]) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `../shots/${name}.png` });
  console.log("shot", route);
}
await browser.close();
