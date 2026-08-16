import { chromium } from "playwright";
const routes = [
  ["/", "m-home"],
  ["/standings", "m-standings"],
  ["/teams/KC", "m-team"],
  ["/lab", "m-lab"],
  ["/war", "m-war"],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const issues = [];
for (const [route, name] of routes) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    viewW: window.innerWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  issues.push(`${name}: doc ${m.docW}px vs viewport ${m.viewW}px ${m.overflow ? "OVERFLOWS" : "ok"}`);
  await page.screenshot({ path: `../shots/${name}.png` });
}
console.log(issues.join("\n"));
await browser.close();
