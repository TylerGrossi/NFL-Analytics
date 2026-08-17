import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Brand, BrandMark } from "@/components/Brand";
import { MainNav, MobileNav } from "@/components/MainNav";
import { PlayerSearch } from "@/components/PlayerSearch";
import { SortableTables } from "@/components/SortableTables";
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
  // The tab shows the name alone. A tagline after an em dash is truncated to
  // noise at tab width, and the name is what someone scans a tab strip for.
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.description,
  openGraph: {
    siteName: SITE.name,
    type: "website",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen flex flex-col">
        {/* Upgrades every `.grid-table` in place — see the component. */}
        <SortableTables />
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
          <div className="mx-auto max-w-[1440px] px-5 py-7">
            <div className="flex items-center gap-2 mb-2 text-navy">
              <BrandMark size={16} />
              <span className="headline text-[14px]">{SITE.name}</span>
            </div>
            <p className="text-[11.5px] text-ink-3 leading-relaxed m-0 max-w-[86ch]">
              Play-by-play, rosters and advanced stats from{" "}
              <a href="https://nflverse.nflverse.com/" className="text-accent">nflverse</a>;
              tracking-derived metrics from NFL Next Gen Stats; coverage and pressure data from
              Pro Football Reference; contracts from Over The Cap; live game state from ESPN.
              Team logos and player headshots are property of their respective clubs and the NFL.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
