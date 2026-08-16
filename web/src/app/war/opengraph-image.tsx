import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard, ogStat } from "@/lib/og";
import { getManifest, getWarLeaders, getWarValidation } from "@/lib/queries";
import { num } from "@/lib/format";

export const alt = "Wins above replacement";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const manifest = await getManifest();
  const season = manifest.stats_season;
  const [leaders, validation] = await Promise.all([
    getWarLeaders(season, "ALL", 1),
    getWarValidation(),
  ]);
  const top = leaders[0];

  return new ImageResponse(
    ogCard({
      eyebrow: `${season} · every position on the roster`,
      title: "Wins above replacement",
      subtitle: top ? `${season} leader: ${top.name} — ${num(top.war, 1)} WAR` : undefined,
      stats: [
        validation?.team_war_vs_wins_r_full_coverage
          ? ogStat("Team WAR vs wins", `r ${num(validation.team_war_vs_wins_r_full_coverage, 2)}`)
          : null,
        validation?.points_per_win
          ? ogStat("Points per win", num(validation.points_per_win, 1))
          : null,
        ogStat("Roles priced", "8"),
      ].filter(Boolean) as React.ReactElement[],
      footer: `${season} season · backtests published`,
    }),
    size
  );
}
