import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const route of ["/scores", "/stats"]) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => {
    const vw = window.innerWidth;
    const rows = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 20) {
        rows.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 80),
          right: Math.round(r.right),
          w: Math.round(r.width),
          text: (el.textContent || "").trim().slice(0, 30),
        });
      }
    });
    return rows.slice(0, 8);
  });
  console.log(`\n=== ${route}`);
  out.forEach((o) => console.log(`  right ${o.right} w ${o.w}  ${o.tag}.${o.cls}  "${o.text}"`));
}
await browser.close();
