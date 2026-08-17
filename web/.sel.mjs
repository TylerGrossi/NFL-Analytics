import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 420 } });
await p.goto("http://localhost:3111/teams", { waitUntil: "domcontentloaded", timeout: 180000 });
await p.waitForSelector("#season-select", { timeout: 120000 });
await p.waitForTimeout(600);
const count = await p.locator("#season-select option").count();
console.log("options in select:", count);
console.log("current value    :", await p.locator("#season-select").inputValue());
await p.screenshot({ path: process.argv[2] });
// change season and confirm the URL follows
await p.selectOption("#season-select", "2019");
await p.waitForURL(/season=2019/, { timeout: 120000 }).then(
  () => console.log("navigated to  :", p.url()),
  () => console.log("NAV FAILED, url:", p.url())
);
await b.close();
