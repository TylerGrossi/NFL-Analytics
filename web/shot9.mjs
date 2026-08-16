import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
await page.goto("http://localhost:3000/war?pos=DEF", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: "../shots/war-defense.png" });
console.log("shot");
await browser.close();
