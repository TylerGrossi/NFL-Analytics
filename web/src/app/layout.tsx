import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Brand, BrandMark } from "@/components/Brand";
import { MainNav, MobileNav } from "@/components/MainNav";
import { PlayerSearch } from "@/components/PlayerSearch";
import { getManifest } from "@/lib/queries";
import { SITE } from "@/lib/site";

// One typeface, carrying hierarchy through weight and size rather than through
// a second condensed face set in capitals. Inter is drawn for interfaces: tight
// vertical metrics, a tall x-height that survives at 11px, and real tabular
// figures that line up in a table without help.
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  // Social crawlers need absolute image URLs. Without a base, the generated
  // opengraph-image routes emit relative paths and every card comes out blank.
  // Set NEXT_PUBLIC_SITE_URL in the deploy environment; localhost is only the
  // development fallback.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: {
    siteName: SITE.name,
    type: "website",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let manifest = null;
  try {
    manifest = await getManifest();
  } catch {
    // Pipeline hasn't run yet — pages render their own empty states.
  }

  const built = manifest
    ? new Date(manifest.generated_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const coverage = manifest?.coverage;

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col">
        <header>
          {/* Identity, section nav, search. Provenance lives in the footer. */}
          <div className="sticky top-0 z-50 bg-navy border-b border-white/10">
            <div className="mx-auto max-w-[1440px] px-5 h-[54px] flex items-stretch gap-6">
              <div className="flex items-center">
                <Brand />
              </div>
              <div className="hidden md:block">
                <MainNav />
              </div>
              <div className="flex-1" />
              <div className="flex items-center">
                <PlayerSearch />
              </div>
            </div>
          </div>

          {/* Narrow screens get the sections on their own scrollable row. */}
          <div className="md:hidden bg-navy border-b border-white/10 overflow-x-auto">
            <div className="mx-auto max-w-[1440px] px-5 h-[42px]">
              <MobileNav />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] px-5 py-6 pb-20 flex-1">{children}</main>

        <footer className="border-t border-rule bg-panel mt-auto">
          <div className="mx-auto max-w-[1440px] px-5 py-7 flex gap-8 flex-wrap justify-between">
            <div className="max-w-[62ch]">
              <div className="flex items-center gap-2 mb-2 text-navy">
                <BrandMark size={16} />
                <span className="headline text-[14px]">{SITE.name}</span>
              </div>
              <p className="text-[11.5px] text-ink-3 leading-relaxed m-0">
                Play-by-play, rosters and advanced stats from{" "}
                <a href="https://nflverse.nflverse.com/" className="text-accent">nflverse</a>;
                tracking-derived metrics from NFL Next Gen Stats; coverage and pressure data from
                Pro Football Reference; contracts from Over The Cap; live game state from ESPN.
                Team logos and player headshots are property of their respective clubs and the NFL.
              </p>
            </div>
            <div className="text-[11.5px] text-ink-3">
              <div className="label mb-1.5">Data</div>
              {manifest && (
                <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 m-0">
                  <dt>Seasons</dt>
                  <dd className="num text-ink-2 m-0">
                    {manifest.seasons[0]}–{manifest.seasons[manifest.seasons.length - 1]}
                  </dd>
                  {coverage && (
                    <>
                      <dt>Plays</dt>
                      <dd className="num text-ink-2 m-0">{coverage.plays.toLocaleString("en-US")}</dd>
                      <dt>Games</dt>
                      <dd className="num text-ink-2 m-0">{coverage.games.toLocaleString("en-US")}</dd>
                      <dt>Players</dt>
                      <dd className="num text-ink-2 m-0">{coverage.players.toLocaleString("en-US")}</dd>
                    </>
                  )}
                  <dt>Built</dt>
                  <dd className="num text-ink-2 m-0">{built}</dd>
                </dl>
              )}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
