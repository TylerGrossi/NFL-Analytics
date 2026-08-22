import Link from "next/link";
import { Empty, Panel, SectionRule, TeamMark } from "@/components/ui";
import {
  getManifest,
  getOddsSeasons,
  getPlayoffOdds,
  getPlayoffSeeds,
  getStandings,
  getTeamMap,
} from "@/lib/queries";
import { num, pct } from "@/lib/format";

export const metadata = { title: "Playoffs" };
export const revalidate = 300;

const SEED_KEYS = [
  "seed_1_odds",
  "seed_2_odds",
  "seed_3_odds",
  "seed_4_odds",
  "seed_5_odds",
  "seed_6_odds",
  "seed_7_odds",
] as const;

/** Odds read as a heat ramp; the number alone is hard to scan across 16 teams. */
function heat(p: number): string {
  if (p <= 0) return "transparent";
  return `color-mix(in oklab, var(--c1) ${Math.round(12 + p * 88)}%, var(--panel))`;
}

export default async function PlayoffsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getOddsSeasons();
  const season = Number(sp.season ?? seasons[0] ?? manifest.scheduled_season);

  const [odds, seeds, teams, standings] = await Promise.all([
    getPlayoffOdds(season),
    getPlayoffSeeds(season),
    getTeamMap(season),
    getStandings(season),
  ]);

  const complete = seeds.length > 0;

  return (
    <>
      <SectionRule>Playoff picture</SectionRule>

      <div className="flex gap-1.5 flex-wrap items-center mb-4">
        <span className="label">Season</span>
        {seasons.map((s) => (
          <Link
            key={s}
            href={`/playoffs?season=${s}`}
            className={`num px-2.5 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline ${
              s === season
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {complete && (
        <>
          <SectionRule>
            {standings.length ? "Seeding" : "Projected seeding"}
          </SectionRule>
          <div className="grid gap-4 lg:grid-cols-2 mb-2">
            {["AFC", "NFC"].map((conf) => (
              <Panel key={conf} title={conf}>
                <div className="px-2 py-1">
                  {seeds
                    .filter((s) => s.conf === conf && s.seed <= 7)
                    .map((s) => {
                      const row = standings.find((t) => t.team === s.team);
                      return (
                        <div
                          key={s.team}
                          className="flex items-center gap-3 px-2 py-1.5 border-b border-rule last:border-0"
                        >
                          <span className="num text-[13px] w-[18px] text-ink-3">{s.seed}</span>
                          <TeamMark
                            team={s.team}
                            logo={teams[s.team]?.logo}
                            href={`/teams/${s.team}`}
                            name={teams[s.team]?.nick ?? s.team}
                          />
                          <span className="flex-1" />
                          <span className="num text-[12px] text-ink-2">
                            {row ? `${row.w}-${row.l}${row.t ? `-${row.t}` : ""}` : ""}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}

      <SectionRule>Odds</SectionRule>
      {odds.length === 0 ? (
        <Empty>No simulation stored for this season.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {["AFC", "NFC"].map((conf) => (
            <Panel key={conf} title={conf}>
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="l">Team</th>
                      <th>xWins</th>
                      <th>Div</th>
                      <th>Playoffs</th>
                      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                        <th key={n}>{n}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {odds
                      .filter((o) => o.conf === conf)
                      .map((o) => (
                        <tr key={o.team}>
                          <td className="l">
                            <TeamMark
                              team={o.team}
                              logo={teams[o.team]?.logo}
                              href={`/teams/${o.team}`}
                              name={teams[o.team]?.nick ?? o.team}
                            />
                          </td>
                          <td className="num text-ink-2">{num(o.expected_wins, 1)}</td>
                          <td className="num text-ink-2">{pct(o.division_odds, 0)}</td>
                          <td className="num font-semibold">{pct(o.playoff_odds, 0)}</td>
                          {SEED_KEYS.map((k) => {
                            const v = o[k] as number;
                            return (
                              <td
                                key={k}
                                className="num text-[11px]"
                                style={{
                                  background: heat(v),
                                  color: v > 0.55 ? "#fff" : "var(--ink-3)",
                                }}
                              >
                                {v >= 0.005 ? Math.round(v * 100) : ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </div>
      )}

    </>
  );
}
