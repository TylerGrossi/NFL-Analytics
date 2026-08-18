import Link from "next/link";
import { Deck, Empty, Panel, PageHead, TeamMark } from "@/components/ui";
import {
  getCoverageLeaders,
  getSeparationLeaders,
  getSeparationSeasons,
  getManifest,
  getTeamMap,
} from "@/lib/queries";
import { int, num, pct, signed } from "@/lib/format";

export const metadata = { title: "Separation" };
export const revalidate = 300;

/** 100 is average, 15 points a standard deviation — the IQ-style scale. */
function scoreColor(score: number): string {
  const z = (score - 100) / 15;
  if (z >= 1) return "var(--pos)";
  if (z <= -1) return "var(--neg)";
  return "var(--ink-2)";
}

function ScoreBar({ score }: { score: number }) {
  // Clamp to roughly ±3 SD for the bar; the number stays exact.
  const pctOf = Math.max(0, Math.min(100, ((score - 55) / 90) * 100));
  return (
    <span className="relative block h-[12px] rounded-[2px] bg-panel-2">
      <span className="absolute inset-y-0 w-px bg-rule-strong" style={{ left: "50%" }} />
      <span
        className="absolute inset-y-[2px] rounded-[1px]"
        style={{
          left: score >= 100 ? "50%" : `${pctOf}%`,
          width: `${Math.abs(pctOf - 50)}%`,
          background: score >= 100 ? "var(--c1)" : "var(--c2)",
        }}
      />
    </span>
  );
}

export default async function SeparationPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getSeparationSeasons();
  const season = Number(sp.season ?? seasons[0] ?? manifest.stats_season);

  const [receivers, defenders, teams] = await Promise.all([
    getSeparationLeaders(season, 40),
    getCoverageLeaders(season, 40),
    getTeamMap(),
  ]);

  return (
    <>
      <PageHead>
        Separation &amp; coverage
      </PageHead>

      <Deck>
        Both sides scored against what their target depth predicts, because raw separation mostly
        measures route depth.
      </Deck>

      <div className="flex gap-1.5 flex-wrap items-center mb-4">
        <span className="label">Season</span>
        {seasons.map((s) => (
          <Link
            key={s}
            href={`/separation?season=${s}`}
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

      <div className="grid gap-4 xl:grid-cols-2 items-start">
        {/* ------------------------------------------------ receivers */}
        <Panel title="Receivers · separation score">
          {receivers.length === 0 ? (
            <Empty>No Next Gen separation stored for this season.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="l">Player</th>
                    <th className="l">Tm</th>
                    <th>Tgt</th>
                    <th>aDOT</th>
                    <th>Sep</th>
                    <th>Exp</th>
                    <th>+/−</th>
                    <th className="l" style={{ width: 92 }}>Score</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {receivers.map((r, i) => (
                    <tr key={`${r.player_id ?? r.name}-${i}`}>
                      <td className="num text-ink-3">{i + 1}</td>
                      <td className="l">
                        {r.player_id ? (
                          <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                            {r.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.name}</span>
                        )}{" "}
                        <span className="text-ink-3 text-[10.5px]">{r.position}</span>
                      </td>
                      <td className="l">
                        <TeamMark
                          team={r.team}
                          logo={teams[r.team]?.logo}
                          size={16}
                          showAbbr={false}
                          href={`/teams/${r.team}`}
                        />
                      </td>
                      <td className="num text-ink-2">{int(r.targets)}</td>
                      <td className="num text-ink-2">{num(r.avg_intended_air_yards, 1)}</td>
                      <td className="num text-ink-2">{num(r.avg_separation, 2)}</td>
                      <td className="num text-ink-3">{num(r.expected_separation, 2)}</td>
                      <td
                        className="num"
                        style={{ color: r.separation_over_expected >= 0 ? "var(--pos)" : "var(--neg)" }}
                      >
                        {signed(r.separation_over_expected, 2)}
                      </td>
                      <td className="l">
                        <ScoreBar score={r.separation_score} />
                      </td>
                      <td
                        className="num font-semibold"
                        style={{ color: scoreColor(r.separation_score) }}
                      >
                        {num(r.separation_score, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ------------------------------------------------ defenders */}
        <Panel title="Defenders · coverage score">
          {defenders.length === 0 ? (
            <Empty>No coverage charting stored for this season.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="l">Player</th>
                    <th className="l">Pos</th>
                    <th className="l">Tm</th>
                    <th>Tgt</th>
                    <th>dADOT</th>
                    <th>Y/Tgt</th>
                    <th>Exp</th>
                    <th>Cmp%</th>
                    <th>Rtg</th>
                    <th className="l" style={{ width: 92 }}>Score</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {defenders.map((d, i) => (
                    <tr key={`${d.pfr_id}-${i}`}>
                      <td className="num text-ink-3">{i + 1}</td>
                      <td className="l">
                        {d.player_id ? (
                          <Link href={`/players/${d.player_id}`} className="link-cell font-medium">
                            {d.name}
                          </Link>
                        ) : (
                          <span className="font-medium">{d.name}</span>
                        )}
                      </td>
                      <td className="l text-ink-3 text-[11px]">{d.position}</td>
                      <td className="l">
                        <TeamMark
                          team={d.team}
                          logo={teams[d.team]?.logo}
                          size={16}
                          showAbbr={false}
                          href={`/teams/${d.team}`}
                        />
                      </td>
                      <td className="num text-ink-2">{int(d.tgt)}</td>
                      <td className="num text-ink-2">{num(d.dadot, 1)}</td>
                      <td className="num text-ink-2">{num(d.yds_tgt, 2)}</td>
                      <td className="num text-ink-3">{num(d.expected_yds_per_target, 2)}</td>
                      <td className="num text-ink-2">{pct(d.cmp_percent, 0)}</td>
                      <td className="num text-ink-2">{num(d.rat, 1)}</td>
                      <td className="l">
                        <ScoreBar score={d.coverage_score} />
                      </td>
                      <td
                        className="num font-semibold"
                        style={{ color: scoreColor(d.coverage_score) }}
                      >
                        {num(d.coverage_score, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

    </>
  );
}
