import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard, ogStat } from "@/lib/og";
import { getManifest } from "@/lib/queries";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const manifest = await getManifest().catch(() => null);
  const c = manifest?.coverage;
  const fmt = (n: number) => n.toLocaleString("en-US");

  return new ImageResponse(
    ogCard({
      eyebrow: "NFL analytics, built on open data",
      title: SITE.name,
      subtitle: "Opponent-adjusted efficiency, WAR with published backtests, and a live play store",
      stats: c
        ? [
            ogStat("Plays", fmt(c.plays)),
            ogStat("Games", fmt(c.games)),
            ogStat("Players", fmt(c.players)),
          ]
        : [],
      footer: manifest
        ? `${manifest.seasons[0]}–${manifest.seasons[manifest.seasons.length - 1]} · free, no signup`
        : "free, no signup",
    }),
    size
  );
}
