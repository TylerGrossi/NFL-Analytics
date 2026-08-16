import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, ogCard, ogStat } from "@/lib/og";
import {
  getGameById,
  getGamePreview,
  getGameTeamSummary,
  getManifest,
  getTeamMap,
  isNflverseGameId,
} from "@/lib/queries";
import { num, pct, signed } from "@/lib/format";

export const alt = "Game card";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const manifest = await getManifest();
  const teams = await getTeamMap();

  // Live games are keyed by ESPN id and have no stored row; the generic card
  // is the honest fallback rather than inventing a scoreline.
  const game = isNflverseGameId(id) ? await getGameById(id) : null;
  if (!game) {
    return new ImageResponse(
      ogCard({
        eyebrow: "Game",
        title: "Hashmark",
        subtitle: "Win probability, drives and every play scored",
        stats: [],
        footer: `hashmark · ${manifest.stats_season} data`,
      }),
      size
    );
  }

  const away = teams[game.away_team]?.nick ?? game.away_team;
  const home = teams[game.home_team]?.nick ?? game.home_team;
  const week = game.game_type === "REG" ? `Week ${game.week}` : game.game_type;

  if (game.played) {
    // A final score alone is available everywhere. What is worth sharing from
    // here is how the game was actually played, so the card carries the EPA.
    const summary = await getGameTeamSummary(game.season, game.game_id);
    const epaOf = (t: string) => summary.find((r) => r.team === t)?.epa ?? null;
    const winner = game.winner ?? game.home_team;
    return new ImageResponse(
      ogCard({
        eyebrow: `${week} · ${game.season} · final`,
        title: `${game.away_team} ${game.away_score} — ${game.home_score} ${game.home_team}`,
        subtitle: `${away} at ${home}`,
        accent: teams[winner]?.color,
        accentAlt: teams[winner]?.color2,
        stats: [
          ogStat(`${game.away_team} EPA / play`, signed(epaOf(game.away_team))),
          ogStat(`${game.home_team} EPA / play`, signed(epaOf(game.home_team))),
        ],
        footer: `${game.season} season · nflverse`,
      }),
      size
    );
  }

  const preview = await getGamePreview(game.game_id);
  return new ImageResponse(
    ogCard({
      eyebrow: `${week} · ${game.season} · projection`,
      title: `${game.away_team} at ${game.home_team}`,
      subtitle: `${away} at ${home}`,
      accent: teams[game.home_team]?.color,
      accentAlt: teams[game.home_team]?.color2,
      stats: preview
        ? [
            ogStat(
              "Projected",
              `${num(preview.proj_away_score, 0)} — ${num(preview.proj_home_score, 0)}`
            ),
            ogStat(`${game.home_team} win`, pct(preview.home_wp, 0)),
          ]
        : [],
      footer: `${game.season} projection · model line`,
    }),
    size
  );
}
