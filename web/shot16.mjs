import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto("http://localhost:3000/lab?group=receiver&coverage=man&personnel=11&min=25", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: "../shots/lab.png" });
console.log("shot");
await browser.close();
