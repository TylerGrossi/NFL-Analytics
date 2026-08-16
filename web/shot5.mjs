import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1500 } });
await page.goto("http://localhost:3000/games/2025_22_SEA_NE", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "../shots/game-completed.png" });
console.log("shot");
await browser.close();
