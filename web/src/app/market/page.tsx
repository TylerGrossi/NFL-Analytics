import Link from "next/link";
import { Deck, Empty, Notes, Panel, SectionRule, StatTile, TeamMark } from "@/components/ui";
import {
  getManifest,
  getMarketDisagreements,
  getMarketTeams,
  getMarketValidation,
  getTeamMap,
  getWeekPreviews,
} from "@/lib/queries";
import { num, pct, signed } from "@/lib/format";

export const metadata = { title: "Model vs market" };
export const revalidate = 900;

export default async function MarketPage() {
  const manifest = await getManifest();
  const [v, teams, biases, upsets] = await Promise.all([
    getMarketValidation(),
    getTeamMap(),
    getMarketTeams(),
    getMarketDisagreements(15),
  ]);

  if (!v) {
    return (
      <>
        <SectionRule>Model vs market</SectionRule>
        <Empty>The market backtest has not been built yet. Run the pipeline.</Empty>
      </>
    );
  }

  const week = manifest.season_state?.current_week || 1;
  const previews = await getWeekPreviews(manifest.scheduled_season, week);
  const withLine = previews.filter((p) => p.spread_line !== null);

  const beatsMarket = v.model.rmse < v.market.rmse;
  const ats = v.ats_hit_rate ?? 0;
  const edgeVerdict = ats > v.breakeven ? "good" : ats >= 0.5 ? "neutral" : "bad";

  return (
    <>
      <SectionRule aside={`${v.first_season}–${v.last_season} · walk-forward`}>
        Model vs market
      </SectionRule>

      <Deck>
        The projection against the closing line, backtested on {v.games.toLocaleString()} games it
        never trained on.
      </Deck>

      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(190px,1fr))] mb-4">
        <StatTile
          label="Model error"
          value={num(v.model.rmse, 2)}
          meta="RMSE, points of margin"
        />
        <StatTile
          label="Closing line error"
          value={num(v.market.rmse, 2)}
          meta={beatsMarket ? "the model is closer" : "the market is closer"}
          tone={beatsMarket ? "good" : "bad"}
        />
        <StatTile
          label="Straight up"
          value={pct(v.straight_up, 1)}
          meta={`${v.straight_up_games.toLocaleString()} games`}
        />
        <StatTile
          label="Against the spread"
          value={pct(v.ats_hit_rate, 1)}
          tone={edgeVerdict === "good" ? "good" : edgeVerdict === "bad" ? "bad" : undefined}
          meta={`${pct(v.breakeven, 1)} breaks even at −110`}
        />
        <StatTile
          label="Agreement with the line"
          value={num(v.correlation_with_line, 3)}
          meta="correlation of projected margin"
        />
      </div>

      <div className="panel px-4 py-3 mb-4 text-[12.5px] text-ink-2">
        <b className="text-ink">The honest headline:</b> the market is better. Over{" "}
        {v.ats_games.toLocaleString()} games the model picks the covering side{" "}
        {pct(v.ats_hit_rate, 1)} of the time, against the {pct(v.breakeven, 1)} a −110 price needs
        to break even. This page exists to evaluate the model, not to sell picks — and a null
        result reported plainly is the only version of it worth publishing.
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel
          title="Where the model disagrees most"
          meta="hit rate by distance from the closing line"
        >
          {v.ats_by_edge.length === 0 ? (
            <Empty>Not enough graded games to bucket.</Empty>
          ) : (
            <>
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th className="l">Disagreement</th>
                      <th>Games</th>
                      <th>Hit rate</th>
                      <th className="l" style={{ width: 150 }} aria-label="Against breakeven" />
                    </tr>
                  </thead>
                  <tbody>
                    {v.ats_by_edge.map((b) => {
                      const over = b.hit_rate >= v.breakeven;
                      // Centre the bar on 50%; the breakeven tick sits just right of it.
                      const span = (b.hit_rate - 0.5) * 100;
                      return (
                        <tr key={`${b.from}-${b.to}`}>
                          <td className="l">
                            {b.from}–{b.to ?? "+"} pts
                          </td>
                          <td className="num text-ink-2">{b.games.toLocaleString()}</td>
                          <td
                            className="num font-semibold"
                            style={{ color: over ? "var(--pos)" : undefined }}
                          >
                            {pct(b.hit_rate, 1)}
                          </td>
                          <td className="l">
                            <span className="relative block h-[13px] bg-panel-2 rounded-[2px]">
                              <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" />
                              <span
                                className="absolute inset-y-0 rounded-[1px]"
                                style={{
                                  left: span >= 0 ? "50%" : `${50 + span * 3}%`,
                                  width: `${Math.min(48, Math.abs(span) * 3)}%`,
                                  background: over ? "var(--pos)" : "var(--neg)",
                                  opacity: 0.75,
                                }}
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-2">
                A model with an edge would hit hardest in the bottom rows, where it disagrees with
                the market most. This one does the opposite — the further it strays from the line,
                the more often it is wrong. That is the clearest evidence on this page that the
                closing line already knows what the model knows.
              </div>
            </>
          )}
        </Panel>

        <Panel title="Win probability calibration" meta="predicted against what happened">
          {v.calibration.length === 0 ? (
            <Empty>Not enough graded games.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Predicted</th>
                    <th>Model said</th>
                    <th>Home won</th>
                    <th>Gap</th>
                    <th>Games</th>
                  </tr>
                </thead>
                <tbody>
                  {v.calibration.map((c) => {
                    const gap = c.actual - c.predicted;
                    return (
                      <tr key={c.bucket}>
                        <td className="l">{c.bucket}</td>
                        <td className="num text-ink-2">{pct(c.predicted, 1)}</td>
                        <td className="num font-semibold">{pct(c.actual, 1)}</td>
                        <td
                          className="num"
                          style={{
                            color: Math.abs(gap) > 0.06 ? "var(--neg)" : "var(--ink-3)",
                          }}
                        >
                          {signed(gap * 100, 1)}
                        </td>
                        <td className="num text-ink-3">{c.games.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {withLine.length > 0 && (
        <Panel
          title={`Week ${week} · model against the line`}
          meta={`${manifest.scheduled_season} · positive means the model likes the home side more`}
          className="mt-4"
        >
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Game</th>
                  <th>Line</th>
                  <th>Model</th>
                  <th>Gap</th>
                  <th>Home win</th>
                </tr>
              </thead>
              <tbody>
                {withLine.map((p) => {
                  const gap = p.proj_margin - (p.spread_line ?? 0);
                  return (
                    <tr key={p.game_id}>
                      <td className="l">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <TeamMark
                            team={p.away_team}
                            logo={teams[p.away_team]?.logo}
                            size={16}
                            href={`/teams/${p.away_team}`}
                          />
                          <span className="text-ink-3">at</span>
                          <TeamMark
                            team={p.home_team}
                            logo={teams[p.home_team]?.logo}
                            size={16}
                            href={`/teams/${p.home_team}`}
                          />
                        </span>
                      </td>
                      <td className="num text-ink-2">{signed(p.spread_line, 1)}</td>
                      <td className="num">{signed(p.proj_margin, 1)}</td>
                      <td
                        className="num font-semibold"
                        style={{
                          color: Math.abs(gap) >= 3 ? "var(--accent)" : undefined,
                        }}
                      >
                        {signed(gap, 1)}
                      </td>
                      <td className="num text-ink-2">{pct(p.home_wp, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start mt-4">
        {biases.length > 0 && (
          <Panel title="Market bias by club" meta="average points beaten the line by">
            <div className="scroll-x max-h-[420px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Team</th>
                    <th>vs line</th>
                    <th>Cover rate</th>
                    <th>Games</th>
                  </tr>
                </thead>
                <tbody>
                  {biases.map((b) => (
                    <tr key={b.team}>
                      <td className="l">
                        <TeamMark
                          team={b.team}
                          logo={teams[b.team]?.logo}
                          href={`/teams/${b.team}`}
                          name={teams[b.team]?.nick ?? b.team}
                        />
                      </td>
                      <td
                        className="num font-semibold"
                        style={{ color: b.avg_vs_line >= 0 ? "var(--pos)" : "var(--neg)" }}
                      >
                        {signed(b.avg_vs_line, 2)}
                      </td>
                      <td className="num text-ink-2">{pct(b.cover_rate, 1)}</td>
                      <td className="num text-ink-3">{b.games.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {upsets.length > 0 && (
          <Panel title="Biggest disagreements on record" meta="and who was right">
            <div className="scroll-x max-h-[420px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Game</th>
                    <th>Line</th>
                    <th>Model</th>
                    <th>Result</th>
                    <th className="l">Right</th>
                  </tr>
                </thead>
                <tbody>
                  {upsets.map((g) => (
                    <tr key={g.game_id}>
                      <td className="l text-[11.5px]">
                        <Link href={`/games/${g.game_id}`} className="link-cell">
                          {g.away_team} at {g.home_team}
                        </Link>
                        <span className="text-ink-3 ml-1.5">{g.season}</span>
                      </td>
                      <td className="num text-ink-2">{signed(g.spread_line, 1)}</td>
                      <td className="num text-ink-2">{signed(g.proj_margin, 1)}</td>
                      <td className="num">{signed(g.margin, 0)}</td>
                      <td
                        className="l text-[11.5px] font-medium"
                        style={{
                          color:
                            g.ats_win === null
                              ? "var(--ink-3)"
                              : g.ats_win
                                ? "var(--pos)"
                                : "var(--neg)",
                        }}
                      >
                        {g.ats_win === null ? "push" : g.ats_win ? "model" : "market"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>

      <Notes>
        <p>
          <b>Walk-forward only.</b> For each test season the model is fit on completed games from
          earlier seasons and never sees the year it is scoring. Anything else is a fit reported as
          a forecast. The first test season is {v.first_season}, which is where nflverse&apos;s
          closing lines become reliable enough that a hit rate is not quietly biased by gaps.
        </p>
        <p>
          <b>Sign convention.</b> nflverse stores <span className="num">spread_line</span> as the
          points the <em>home</em> team is favoured by, so a home favourite is positive and it is
          directly comparable to the projected margin. A posted betting line states the favourite as
          a negative number; this page uses the stored convention throughout.
        </p>
        <p>
          <b>Grading.</b> The model takes whichever side it rates above the market. A push is
          excluded rather than counted as half a win — there were {v.ats_pushes} of them across{" "}
          {v.games_with_line.toLocaleString()} games with a line. Totals are graded the same way:{" "}
          {v.total_hit_rate === null ? "not enough data" : pct(v.total_hit_rate, 1)} over{" "}
          {v.total_games.toLocaleString()} games.
        </p>
        <p>
          <b>What the model does not know.</b> Who is starting at quarterback, injuries, weather,
          rest, travel, or anything that happened after the last completed game. The closing line
          knows all of it. That is most of the {num(v.market.rmse, 2)} against{" "}
          {num(v.model.rmse, 2)} gap, and it is why the honest framing here is model evaluation
          rather than a betting product.
        </p>
      </Notes>
    </>
  );
}
