/**
 * Visual check helper.
 *
 *   node shot.mjs                     every default route
 *   node shot.mjs /war                one route
 *   node shot.mjs /war war.png 390    one route, named, at a phone width
 *   PORT=3111 node shot.mjs /war      against a different dev server
 *
 * Writes to ../shots/, which is gitignored. Reports page errors, because a
 * screenshot of a broken page still looks like a screenshot.
 */
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3000";
const DEFAULT_ROUTES = [
  "/", "/scores", "/standings", "/teams", "/war", "/coaches",
  "/market", "/week", "/fantasy/draft", "/lab",
];

const [route, outfile, width] = process.argv.slice(2);
const routes = route ? [route] : DEFAULT_ROUTES;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(width ?? 1280), height: 1000 },
});

let failed = 0;
for (const r of routes) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const name = outfile ?? `${r === "/" ? "home" : r.replace(/[/?=&]/g, "_").replace(/^_/, "")}.png`;
  await page.goto(`http://localhost:${PORT}${r}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.screenshot({ path: `../shots/${name}`, fullPage: true });
  page.removeAllListeners("pageerror");
  if (errors.length) failed++;
  console.log(`${errors.length ? "ERR " : "ok  "} ${r} -> shots/${name}`, errors[0] ?? "");
}

await browser.close();
process.exit(failed ? 1 : 0);
