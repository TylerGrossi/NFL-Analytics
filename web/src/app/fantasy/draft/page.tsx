import Link from "next/link";
import { DraftBoard } from "@/components/DraftBoard";
import { Deck, Empty, PageHead, Panel, TeamMark } from "@/components/ui";
import {
  getDraftBoard,
  getFantasySos,
  getInjuryRates,
  getTeamMap,
  getUnprojected,
} from "@/lib/queries";
import { num } from "@/lib/format";

export const metadata = { title: "Draft board" };
/** What each input buys the projection, measured on the walk-forward backtest. */
const PROJECTION_INPUTS = [
  { input: "Last season's PPG", effect: "r 0.77", why: "strongest single input; the rest are corrections to it" },
  { input: "Sample-size regression", effect: "k = 4", why: "rates pulled toward the positional mean by games / (games + 4)" },
  { input: "A second prior season", effect: "R² +.044", why: "the biggest addition — two years of evidence beat one" },
  { input: "Expected points", effect: "R² +.007", why: "real but small, about a third of the weight of actual" },
];

export const revalidate = 900;

export default async function FantasyDraftPage() {
  const [rows, unprojected, sos, teams, injuryRates] = await Promise.all([
    getDraftBoard(),
    getUnprojected(24),
    getFantasySos(),
    getTeamMap(),
    getInjuryRates(),
  ]);

  // The measured play-probability grid, laid out report status by practice.
  const PRACTICE = ["DNP", "Limited", "Full"];
  const STATUS = ["None", "Questionable", "Doubtful", "Out"];
  const rateAt = (s: string, pr: string) =>
    injuryRates.find((r) => r.status === s && r.practice === pr);

  // One row per club, its schedule rank at each position.
  const byTeam = new Map<string, Record<string, number>>();
  for (const s of sos) {
    const row = byTeam.get(s.team) ?? {};
    row[s.position] = s.sos_rank;
    byTeam.set(s.team, row);
  }
  const matrix = [...byTeam.entries()]
    .map(([team, ranks]) => ({
      team,
      ranks,
      mean: ["QB", "RB", "WR", "TE"].reduce((a, p) => a + (ranks[p] ?? 16), 0) / 4,
    }))
    .sort((a, b) => a.mean - b.mean);
  const rankedOn = rows.find((r) => r.ranked_on)?.ranked_on ?? null;
  const season = rows[0]?.season;

  if (rows.length === 0) {
    return (
      <>
        <PageHead>Draft board</PageHead>
        <Empty>The draft board has not been built yet.</Empty>
      </>
    );
  }

  return (
    <>
      <PageHead
        aside={
          <span className="flex gap-3">
            <Link href="/fantasy/espn" className="text-accent">
              ESPN value
            </Link>
            <Link href="/fantasy" className="text-accent">
              Season values
            </Link>
          </span>
        }
      >
        {season} draft board
      </PageHead>

      <Deck>
        Set your league and the board re-ranks — scoring, roster size, superflex, TE premium.
      </Deck>

      <DraftBoard rows={rows} rankedOn={rankedOn} />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] items-start mt-4">
        <Panel title="What the projection is built on">
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Input</th>
                  <th>Effect</th>
                  <th className="l">Why</th>
                </tr>
              </thead>
              <tbody>
                {PROJECTION_INPUTS.map((r) => (
                  <tr key={r.input}>
                    <td className="l font-medium">{r.input}</td>
                    <td className="num text-ink-2">{r.effect}</td>
                    <td className="l text-[11.5px] text-ink-2">{r.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-3 gap-px bg-rule border-t border-rule">
            {[
              ["3.35", "RMSE", "3,219 seasons from 2014"],
              ["4.0%", "edge", "over a fairly regressed baseline"],
              ["10.4%", "flattering edge", "over a naive baseline"],
            ].map(([v, l, m]) => (
              <div key={l} className="bg-panel px-3.5 py-2.5">
                <div className="num text-[17px] font-semibold leading-tight">{v}</div>
                <div className="text-[11px] text-ink-2">{l}</div>
                <div className="text-[10.5px] text-ink-3">{m}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Ranked but not projected">
          {unprojected.length === 0 ? (
            <Empty>Everyone on the board has a projection.</Empty>
          ) : (
            <div className="scroll-x max-h-[300px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Player</th>
                    <th className="l">Pos</th>
                    <th className="l">Tm</th>
                    <th>ECR</th>
                  </tr>
                </thead>
                <tbody>
                  {unprojected.map((r) => (
                    <tr key={r.player_id}>
                      <td className="l">
                        <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                          {r.name}
                        </Link>
                      </td>
                      <td className="l text-ink-2">{r.position}</td>
                      <td className="l text-ink-3">{r.team ?? "—"}</td>
                      <td className="num">{num(r.ecr_redraft, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 py-2.5 border-t border-rule text-[11px] text-ink-3 leading-relaxed">
            These players are absent from the board above rather than guessed at. A rookie has no NFL
            season to project from, and this site does not ingest college data, so the honest move is
            to leave the column empty and let the consensus rank stand alone.
          </div>
        </Panel>
      </div>

      {injuryRates.length > 0 && (
        <Panel
          title="Will he play?"
          className="mt-4"
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Report</th>
                  {PRACTICE.map((p) => (
                    <th key={p}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STATUS.map((s) => (
                  <tr key={s}>
                    <td className="l font-medium">{s === "None" ? "No designation" : s}</td>
                    {PRACTICE.map((pr) => {
                      const r = rateAt(s, pr);
                      return (
                        <td key={pr} className="num">
                          {!r || r.p_play === null ? (
                            <span className="text-ink-3">—</span>
                          ) : (
                            <>
                              <b
                                className={
                                  r.p_play >= 0.9
                                    ? "text-pos"
                                    : r.p_play <= 0.1
                                      ? "text-neg"
                                      : "text-ink"
                                }
                              >
                                {(r.p_play * 100).toFixed(0)}%
                              </b>
                              <span className="text-ink-3 text-[10.5px] ml-1.5">
                                {(r.n ?? 0).toLocaleString("en-US")}
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-rule text-[11px] text-ink-3 leading-relaxed">
            Every injury report from 2018 on, joined to whether that player actually took a snap
            that week — so these are observed rates, not rules of thumb. The lesson is that practice
            participation carries more than the game designation does: a Questionable player who
            practiced fully plays <b className="text-ink-2">79%</b> of the time, the same
            designation with no practice at all <b className="text-ink-2">46%</b>. Quoting one
            number for &ldquo;Questionable&rdquo; throws away a thirty-point swing. Note too that a
            player on the report with no designation is not healthy — he plays 93%, and 77% if he
            did not practice. Only players whose id demonstrably bridges to the snap data that
            season are counted; otherwise a failed id match looks exactly like a player who sat out
            and every rate is biased down. Small print: this says whether he plays, not how well.
          </div>
        </Panel>
      )}

      {matrix.length > 0 && (
        <Panel
          title="Schedule difficulty"
          className="mt-4"
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Team</th>
                  {["QB", "RB", "WR", "TE"].map((p) => (
                    <th key={p}>{p}</th>
                  ))}
                  <th>Avg</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((m) => (
                  <tr key={m.team}>
                    <td className="l">
                      <TeamMark
                        team={m.team}
                        logo={teams[m.team]?.logo}
                        href={`/teams/${m.team}`}
                        name={teams[m.team]?.nick ?? m.team}
                      />
                    </td>
                    {["QB", "RB", "WR", "TE"].map((p) => {
                      const v = m.ranks[p];
                      return (
                        <td key={p} className="num">
                          {v === undefined ? (
                            "—"
                          ) : (
                            <span
                              className="rank-chip"
                              data-tier={v <= 10 ? "good" : v >= 23 ? "bad" : undefined}
                            >
                              {v}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="num text-ink-2">{m.mean.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-rule text-[11px] text-ink-3 leading-relaxed">
            Worth less than it looks. The gap between the easiest and hardest schedule is 7.7% of
            league-average points for backs and about 15% for receivers and quarterbacks — and that
            is before allowing for the fact that it is built entirely on last season&apos;s defenses,
            which carry year to year at only 0.34. Expect roughly a third of the spread above to
            survive into the coming season. It is a tiebreaker between players you already rate
            similarly, not a reason to move anyone up a round.
          </div>
        </Panel>
      )}

    </>
  );
}
