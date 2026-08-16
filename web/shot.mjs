// Visual check helper: node shot.mjs [path] [outfile]
import { chromium } from "playwright";

const routes = process.argv[2]
  ? [process.argv[2]]
  : ["/", "/standings", "/teams", "/teams/KC", "/players/00-0033873", "/leaders", "/lab", "/scores"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

for (const route of routes) {
  const name = route === "/" ? "home" : route.replace(/\//g, "_").replace(/^_/, "");
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `../shots/${name}.png`, fullPage: false });
  console.log("shot", route);
}

await browser.close();
