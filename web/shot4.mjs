import { chromium } from "playwright";
const id = process.env.EVENT_ID;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
await page.goto(`http://localhost:3000/games/${id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: "../shots/game-center.png" });
console.log("shot");
await browser.close();
