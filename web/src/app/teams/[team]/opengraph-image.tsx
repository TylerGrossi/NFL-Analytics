import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard, ogStat } from "@/lib/og";
import { getManifest, getStandings, getTeam, getTeamSeason } from "@/lib/queries";
import { ordinal, signed } from "@/lib/format";

export const alt = "Team card";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  const abbr = team.toUpperCase();
  const manifest = await getManifest();
  const season = manifest.stats_season;

  const [meta, row, standings] = await Promise.all([
    getTeam(abbr),
    getTeamSeason(abbr, season),
    getStandings(season),
  ]);
  const rec = standings.find((s) => s.team === abbr);

  const stats = [
    rec ? ogStat("Record", `${rec.w}–${rec.l}${rec.t ? `–${rec.t}` : ""}`) : null,
    row ? ogStat("Net EPA / play", signed(row.net_adj), row.net_adj >= 0 ? "pos" : "neg") : null,
    row ? ogStat("Offense", ordinal(row.off_rank)) : null,
    row ? ogStat("Defense", ordinal(row.def_rank)) : null,
  ].filter(Boolean) as React.ReactElement[];

  return new ImageResponse(
    ogCard({
      eyebrow: `${season} · opponent-adjusted`,
      title: meta?.name ?? abbr,
      subtitle: rec ? `${ordinal(rec.div_place)} in the ${rec.division}` : undefined,
      accent: meta?.color,
      accentAlt: meta?.color2,
      stats: stats.length ? stats : [ogStat("Season", String(season))],
      footer: `${season} season · opponent-adjusted`,
    }),
    size
  );
}
