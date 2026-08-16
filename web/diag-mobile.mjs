import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const route of ["/standings", "/war", "/"]) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const wide = await page.evaluate(() => {
    const vw = window.innerWidth;
    const out = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && r.width > 0) {
        const parent = el.parentElement;
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 70),
          w: Math.round(r.width),
          parentTag: parent?.tagName.toLowerCase(),
          parentCls: (parent?.className || "").toString().slice(0, 60),
        });
      }
    });
    // Keep the outermost few — the innermost are just consequences.
    return out.slice(0, 6);
  });
  console.log(`\n=== ${route}`);
  wide.forEach((w) => console.log(`  ${w.tag}.${w.cls} = ${w.w}px  (parent ${w.parentTag}.${w.parentCls})`));
}
await browser.close();
