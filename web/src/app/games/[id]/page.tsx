import Link from "next/link";
import { notFound } from "next/navigation";
import { CompletedGame } from "@/components/CompletedGame";
import { GamePreview } from "@/components/GamePreview";
import { Highlights } from "@/components/Highlights";
import { LiveGame, type LivePayload } from "@/components/LiveGame";
import { Panel, SectionRule, TeamMark } from "@/components/ui";
import { fetchGameSummary, fetchLiveGame } from "@/lib/live";
import {
  getFourthDownPoint,
  getFourthDownRates,
  getGameByEspnId,
  getGameById,
  getGamePreview,
  getDepthChart,
  getTeamCoverage,
  getTeamInjuries,
  getTeamSeparation,
  getManifest,
  getTeamMap,
  getTeamSeason,
  isNflverseGameId,
  snapToGrid,
} from "@/lib/queries";
import { pct, signed } from "@/lib/format";
import { distinguishTeamColors } from "@/lib/colors";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (isNflverseGameId(id)) {
    const g = await getGameById(id);
    return { title: g ? `${g.away_team} at ${g.home_team}` : "Game" };
  }
  const game = await fetchLiveGame(id);
  return { title: game ? `${game.away.abbr} at ${game.home.abbr}` : "Game" };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Two id spaces meet here: our own game ids for anything in the analytics
  // store, and ESPN event ids for live games. A finished ESPN game hands off to
  // the analytics view once its play-by-play has landed.
  if (isNflverseGameId(id)) {
    const stored = await getGameById(id);
    if (!stored) notFound();
    if (stored.played) return <CompletedGame game={stored} />;
    // On the schedule but not yet played: project it.
    const preview = await getGamePreview(id);
    if (preview) return renderPreview(preview);
    return <CompletedGame game={stored} />;
  }

  const [game, summary] = await Promise.all([fetchLiveGame(id), fetchGameSummary(id)]);
  if (!game) {
    const stored = await getGameByEspnId(id);
    if (stored) return <CompletedGame game={stored} />;
    notFound();
  }
  if (game.state === "post") {
    const stored = await getGameByEspnId(id);
    if (stored?.played) return <CompletedGame game={stored} />;
  }
  // Scheduled but not started: the live view has nothing to show yet, so prefer
  // the projection. The scoreboard links unplayed games by ESPN id, which is how
  // a game months away would otherwise land on an empty in-game page.
  if (game.state === "pre") {
    const stored = await getGameByEspnId(id);
    if (stored && !stored.played) {
      const preview = await getGamePreview(stored.game_id);
      if (preview) return renderPreview(preview);
    }
  }

  // Server-render the first decision so the page is useful before JS boots.
  let decision: LivePayload["decision"] = null;
  const p = game.possession;
  if (p && p.yardline100 !== null) {
    const snapped = snapToGrid({
      yardline: p.yardline100,
      ydstogo: p.distance && p.distance > 0 ? p.distance : 1,
      scoreDiff: p.scoreDifferential,
      seconds: p.secondsRemaining,
    });
    const [point, rates] = await Promise.all([
      getFourthDownPoint(snapped.yardline, snapped.ydstogo, snapped.scoreDiff, snapped.seconds),
      getFourthDownRates(snapped.yardline, snapped.ydstogo),
    ]);
    if (point) {
      const options = [
        { key: "GO", value: point.wp_go },
        { key: "FIELD GOAL", value: point.wp_fg },
        { key: "PUNT", value: point.wp_punt },
      ].filter((o) => o.value !== null) as { key: string; value: number }[];
      options.sort((a, b) => b.value - a.value);
      decision = {
        ...point,
        ...rates,
        snapped,
        isFourthDown: p.down === 4,
        best: options[0]?.key ?? null,
        margin: options.length > 1 ? options[0].value - options[1].value : 0,
      };
    }
  }

  const manifest = await getManifest();
  const teams = await getTeamMap();
  const [homeSeason, awaySeason] = await Promise.all([
    getTeamSeason(game.home.abbr, manifest.stats_season),
    getTeamSeason(game.away.abbr, manifest.stats_season),
  ]);

  const colors = distinguishTeamColors(
    teams[game.home.abbr] ?? {},
    teams[game.away.abbr] ?? {}
  );

  return (
    <>
      <SectionRule aside={<Link href="/scores" className="text-accent">All scores</Link>}>
        {game.away.name} at {game.home.name}
      </SectionRule>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr] items-start">
        <div className="flex flex-col gap-4">
          <LiveGame eventId={id} initial={{ game, decision, summary }} colors={colors} />
          <Highlights eventId={id} />
        </div>

        <div className="flex flex-col gap-4">
          {summary && summary.teamStats.length > 0 && (
            <Panel title="Team stats">
              <div className="px-4 py-2">
                {summary.teamStats.map((s) => {
                  const split = barSplit(s.away, s.home);
                  return (
                    <div key={s.name} className="py-[7px] border-b border-rule last:border-0">
                      <div className="flex items-center justify-between text-[12px] mb-1.5">
                        <b className="num">{s.away}</b>
                        <span className="text-ink-3 text-[11px]">{s.label}</span>
                        <b className="num">{s.home}</b>
                      </div>
                      <div className="flex h-[7px] gap-[2px]">
                        <div
                          className="rounded-[2px]"
                          style={{ width: `${split}%`, background: colors.away }}
                        />
                        <div
                          className="rounded-[2px]"
                          style={{ width: `${100 - split}%`, background: colors.home }}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-between text-[11px] text-ink-3 pt-2">
                  <span>{game.away.abbr}</span>
                  <span>{game.home.abbr}</span>
                </div>
              </div>
            </Panel>
          )}

          {summary && summary.leaders.length > 0 && (
            <Panel title="Game leaders">
              <div className="px-4 py-1">
                {summary.leaders.map((l, i) => (
                  <div
                    key={`${l.team}-${l.category}-${i}`}
                    className="flex items-center gap-2.5 py-2 border-b border-rule last:border-0"
                  >
                    {l.headshot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.headshot} alt="" width={26} height={26} className="rounded-full bg-panel-3" />
                    ) : (
                      <span className="w-[26px] h-[26px] rounded-full bg-panel-3 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium truncate">{l.name}</div>
                      <div className="text-[11px] text-ink-3">
                        {l.team} · {l.category}
                      </div>
                    </div>
                    <span className="num text-[12px] text-ink-2 shrink-0">{l.value}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {summary && summary.scoringPlays.length > 0 && (
            <Panel title="Scoring">
              <div className="max-h-[320px] scroll-y px-4 py-1">
                {summary.scoringPlays.map((s) => (
                  <div key={s.id} className="py-2 border-b border-rule last:border-0">
                    <div className="flex items-center justify-between text-[11px] text-ink-3 mb-0.5">
                      <span>
                        {s.team} · Q{s.period} {s.clock}
                      </span>
                      <span className="num">
                        {s.awayScore}–{s.homeScore}
                      </span>
                    </div>
                    <div className="text-[12px] text-ink-2 leading-snug">{s.text}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title={`${manifest.stats_season} form`}>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Off</th>
                    <th>Def</th>
                    <th>Net</th>
                    <th>Succ%</th>
                    <th>PROE</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { abbr: game.away.abbr, row: awaySeason },
                    { abbr: game.home.abbr, row: homeSeason },
                  ].map(({ abbr, row }) => (
                    <tr key={abbr}>
                      <td>
                        <TeamMark
                          team={abbr}
                          logo={teams[abbr]?.logo}
                          href={`/teams/${abbr}`}
                          name={teams[abbr]?.nick ?? abbr}
                        />
                      </td>
                      <td className="num">{row ? signed(row.off_adj) : "—"}</td>
                      <td className="num">{row ? signed(row.def_adj) : "—"}</td>
                      <td className="num font-semibold">{row ? signed(row.net_adj) : "—"}</td>
                      <td className="num text-ink-2">{row ? pct(row.off_success as number, 0) : "—"}</td>
                      <td className="num text-ink-2">
                        {row ? signed(row.neutral_proe as number, 1) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 text-[11px] text-ink-3 border-t border-rule">
              Prior-season form, not tonight&apos;s. Live play-by-play reaches the analytics store
              about fifteen minutes after the final whistle.
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}


/** Assemble both sides of a scheduled game and hand them to the preview. */
async function renderPreview(preview: Awaited<ReturnType<typeof getGamePreview>>) {
  if (!preview) notFound();
  const manifest = await getManifest();
  // Ratings come from the last season with data, which is the one before kickoff.
  const ratingSeason = Math.min(manifest.stats_season, preview.season - 1);
  const teams = await getTeamMap();

  const side = async (abbr: string) => ({
    abbr,
    meta: teams[abbr],
    season: await getTeamSeason(abbr, ratingSeason),
    receivers: await getTeamSeparation(abbr, ratingSeason),
    coverage: await getTeamCoverage(abbr, ratingSeason),
    depth: await getDepthChart(abbr),
    injuries: await getTeamInjuries(abbr, preview.season),
  });

  const [home, away] = await Promise.all([side(preview.home_team), side(preview.away_team)]);
  return <GamePreview preview={preview} home={home} away={away} ratingSeason={ratingSeason} />;
}

/** Share of the bar for the away team; handles "4-11" and "31:24" gracefully. */
function barSplit(away: string, home: string): number {
  const parse = (v: string): number => {
    if (v.includes(":")) {
      const [m, s] = v.split(":").map(Number);
      return (m || 0) * 60 + (s || 0);
    }
    if (v.includes("-")) {
      const [made, att] = v.split("-").map(Number);
      return att ? (made / att) * 100 : 0;
    }
    const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const a = parse(away);
  const h = parse(home);
  const total = a + h;
  if (total <= 0) return 50;
  return Math.max(4, Math.min(96, (a / total) * 100));
}
