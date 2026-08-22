import Link from "next/link";
import { GapChart } from "@/components/GapChart";
import { Scatter, type Metric } from "@/components/Scatter";
import { SeasonNav } from "@/components/SeasonNav";
import { Panel, SectionRule } from "@/components/ui";
import {
  getGapSeasons,
  getGapSplits,
  getManifest,
  getPlayerScatter,
  getTeamMap,
  getTeamScatter,
} from "@/lib/queries";

export const metadata = { title: "Visuals" };
export const revalidate = 900;

const TEAM_METRICS: Metric[] = [
  { key: "off_adj", label: "Offense EPA / play", digits: 3 },
  { key: "def_adj", label: "Defense EPA allowed", digits: 3, invert: true },
  { key: "net_adj", label: "Net EPA / play", digits: 3 },
  { key: "off_pass_epa", label: "Pass EPA / play", digits: 3 },
  { key: "off_rush_epa", label: "Rush EPA / play", digits: 3 },
  { key: "off_success", label: "Success rate", digits: 3 },
  { key: "off_explosive_rate", label: "Explosive rate", digits: 3 },
  { key: "off_points_per_drive", label: "Points per drive", digits: 2 },
  { key: "off_third_conv", label: "Third-down rate", digits: 3 },
  { key: "neutral_proe", label: "Pass rate over expected", digits: 1 },
  { key: "sos", label: "Strength of schedule", digits: 3 },
];

const PLAYER_METRICS: Metric[] = [
  { key: "epa_per_target", label: "EPA per target", digits: 3 },
  { key: "yprr", label: "Yards per route run", digits: 2 },
  { key: "tprr", label: "Targets per route run", digits: 3 },
  { key: "receiving_yards", label: "Receiving yards", digits: 0 },
  { key: "targets", label: "Targets", digits: 0 },
  { key: "routes", label: "Routes run", digits: 0 },
  { key: "target_share", label: "Target share", digits: 3 },
  { key: "wopr", label: "WOPR", digits: 2 },
  { key: "avg_separation", label: "Average separation", digits: 2 },
  { key: "rec_adot", label: "Average depth of target", digits: 1 },
  { key: "yac_per_rec", label: "YAC per reception", digits: 2 },
  { key: "avg_yac_above_expectation", label: "YAC over expected", digits: 2 },
  { key: "rz_targets", label: "Red zone targets", digits: 0 },
  { key: "catch_pct", label: "Catch rate", digits: 3 },
];

export default async function VisualsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; side?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const gapSeasons = await getGapSeasons();
  const season = Number(sp.season ?? gapSeasons[0] ?? manifest.stats_season);
  const side = sp.side === "defense" ? "defense" : "offense";

  const [gaps, teams, teamPoints, playerPoints] = await Promise.all([
    getGapSplits(season, side),
    getTeamMap(season),
    getTeamScatter(season),
    getPlayerScatter(season, ["WR", "TE", "RB"]),
  ]);

  const logos = Object.fromEntries(Object.entries(teams).map(([t, m]) => [t, m?.logo]));
  const nicks = Object.fromEntries(Object.entries(teams).map(([t, m]) => [t, m?.nick]));

  return (
    <>
      <SectionRule>Visuals</SectionRule>

      <SeasonNav
        seasons={gapSeasons}
        active={season}
        href={(s) => `/visuals?season=${s}&side=${side}`}
      />

      <div className="flex gap-2 mb-4">
        {(["offense", "defense"] as const).map((s) => (
          <Link
            key={s}
            href={`/visuals?season=${season}&side=${s}`}
            aria-current={s === side ? "page" : undefined}
            className={`inline-flex items-center h-[30px] px-3 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              s === side
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {s === "offense" ? "Offense" : "Defense"}
          </Link>
        ))}
      </div>

      <Panel
        title="Run gaps"
        meta="EPA per rush · block height is share of carries"
        className="mb-6"
        bodyClass="p-0"
      >
        <GapChart rows={gaps} logos={logos} nicks={nicks} />
      </Panel>

      <SectionRule>Team scatter</SectionRule>
      <Panel bodyClass="px-4 py-3 mb-6">
        <Scatter
          entity="team"
          points={teamPoints}
          metrics={TEAM_METRICS}
          initialX="off_adj"
          initialY="def_adj"
          logos={logos}
        />
      </Panel>

      <SectionRule>Player scatter</SectionRule>
      <Panel bodyClass="px-4 py-3">
        <Scatter
          entity="player"
          points={playerPoints}
          metrics={PLAYER_METRICS}
          initialX="routes"
          initialY="yprr"
        />
      </Panel>

    </>
  );
}
