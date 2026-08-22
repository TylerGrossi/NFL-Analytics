import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard, ogStat } from "@/lib/og";
import { getManifest, getPlayerBio, getPlayerSeason, getTeamMap } from "@/lib/queries";
import { num, signed } from "@/lib/format";

export const alt = "Player card";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = await getManifest();
  const season = manifest.stats_season;

  const [bio, row, teams] = await Promise.all([
    getPlayerBio(id),
    getPlayerSeason(id, season),
    getTeamMap(),
  ]);

  const name = String(bio?.name ?? row?.player_display_name ?? "Player");
  const position = String(bio?.position ?? row?.position ?? "");
  const team = String(row?.recent_team ?? bio?.team ?? "");
  // Whatever this player actually did — a quarterback's card should not lead
  // with carries, and a corner has no dropbacks at all.
  const n = (k: string) => (row?.[k] === null || row?.[k] === undefined ? null : Number(row[k]));
  const stats = [
    n("total_epa") !== null
      ? ogStat("EPA", signed(n("total_epa"), 1), (n("total_epa") ?? 0) >= 0 ? "pos" : "neg")
      : null,
    n("epa_per_db") !== null
      ? ogStat("EPA / dropback", signed(n("epa_per_db"), 3))
      : n("rushing_yards") !== null && (n("carries") ?? 0) > 0
        ? ogStat("Rush yards", num(n("rushing_yards"), 0))
        : n("receiving_yards") !== null && (n("targets") ?? 0) > 0
          ? ogStat("Rec yards", num(n("receiving_yards"), 0))
          : null,
    n("play_success") !== null ? ogStat("Success rate", `${num((n("play_success") ?? 0) * 100, 0)}%`) : null,
  ].filter(Boolean) as React.ReactElement[];

  return new ImageResponse(
    ogCard({
      eyebrow: [position, teams[team]?.name ?? team].filter(Boolean).join(" · "),
      title: name,
      subtitle: `${season} season`,
      accent: teams[team]?.color,
      accentAlt: teams[team]?.color2,
      stats: stats.length ? stats : [ogStat("Season", String(season))],
      footer: `${season} season · nflverse`,
    }),
    size
  );
}
