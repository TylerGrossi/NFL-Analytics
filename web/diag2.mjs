import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const route of ["/scores", "/stats"]) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 90),
          w: Math.round(r.width),
        });
      }
    });
    return out.slice(0, 5);
  });
  console.log(`\n=== ${route}`);
  wide.forEach((w) => console.log(`  ${w.w}px  ${w.tag}.${w.cls}`));
}
await browser.close();
