import Link from "next/link";
import { Deck, Panel, PageHead, TeamMark } from "@/components/ui";
import { FreeAgentPanel, LineupPanel, MatchupPanel } from "@/components/LeagueTools";
import {
  ScoreboardPanel,
  SeasonSummaryPanel,
  TradeSimulator,
} from "@/components/LeagueTrade";
import {
  AllPlayPanel,
  MovesPanel,
  TradeTargetPanel,
  allPlay,
  tradeTargets,
} from "@/components/LeagueSeason";
import {
  getEspnBridge,
  getFantasyVariance,
  getManifest,
  getWeekProjections,
  getRosByPlayer,
  getSleeperBridge,
  getTeamMap,
  type RosPoint,
} from "@/lib/queries";
import {
  fetchEspnLeague,
  fetchSleeperLeague,
  fetchSleeperHistory,
  fetchSleeperMoves,
  fetchSleeperUserLeagues,
  isLeagueError,
  type LeagueChoice,
  type League,
  type LeagueTeam,
} from "@/lib/leagues";
import { num } from "@/lib/format";

export const metadata = { title: "Your league" };
export const revalidate = 300;

/** Roster strength: rest-of-season points, and where they sit. */
function value(team: LeagueTeam, ros: Map<string, RosPoint>) {
  const rows = team.roster
    .map((s) => ({ slot: s, proj: s.playerId ? ros.get(s.playerId) ?? null : null }))
    .sort((a, b) => (b.proj?.ros_points ?? -1) - (a.proj?.ros_points ?? -1));
  const total = rows.reduce((sum, r) => sum + (r.proj?.ros_points ?? 0), 0);
  const covered = rows.filter((r) => r.proj).length;
  return { rows, total, covered };
}

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<{
    platform?: string; id?: string; team?: string; view?: string; vs?: string;
    user?: string; give?: string; get?: string; wk?: string;
  }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const platform = sp.platform === "espn" ? "espn" : "sleeper";
  const leagueId = (sp.id ?? "").trim();

  const username = (sp.user ?? "").trim();
  let league: League | null = null;
  let problem: { error: string; hint?: string } | null = null;
  let choices: { leagues: LeagueChoice[]; season: number; display: string } | null = null;
  // The transaction log returns Sleeper ids; the bridge is what names them.
  let sleeperNames = new Map<string, string>();

  // A username with no league picked yet: resolve it to their league list.
  if (username && !leagueId) {
    const found = await fetchSleeperUserLeagues(username, manifest.scheduled_season);
    if ("error" in found) problem = found;
    else choices = found;
  }

  if (leagueId) {
    const [sleeperBridge, espnBridge] = await Promise.all([
      platform === "sleeper" ? getSleeperBridge() : Promise.resolve(new Map()),
      platform === "espn" ? getEspnBridge() : Promise.resolve(new Map()),
    ]);
    sleeperNames = new Map(
      [...sleeperBridge.entries()].map(([sid, v]) => [sid, v.name])
    );
    const result =
      platform === "sleeper"
        ? await fetchSleeperLeague(leagueId, sleeperBridge)
        : await fetchEspnLeague(leagueId, manifest.scheduled_season, espnBridge);
    if (isLeagueError(result)) problem = result;
    else league = result;
  }

  // Preseason there is no "current" week yet, so week 1 is the useful default.
  const week = Math.max(1, league?.week ?? 1);
  const [ros, teams, proj, fits] = await Promise.all([
    league ? getRosByPlayer() : Promise.resolve(new Map<string, RosPoint>()),
    getTeamMap(),
    league ? getWeekProjections(week) : Promise.resolve(new Map()),
    league ? getFantasyVariance() : Promise.resolve([]),
  ]);
  const VIEWS = [
    "power", "allplay", "lineup", "matchup", "trade", "swap",
    "wire", "moves", "board", "season",
  ];
  const view = VIEWS.includes(sp.view ?? "")
    ? sp.view!
    : "power";

  // Eighteen requests apiece, so only the views that need them pay for them.
  const sleeper = league?.platform === "sleeper";
  const needsHistory = sleeper && ["allplay", "board", "season"].includes(view);
  const [history, moves] = await Promise.all([
    needsHistory ? fetchSleeperHistory(league!.id) : Promise.resolve([]),
    sleeper && view === "moves" ? fetchSleeperMoves(league!.id) : Promise.resolve([]),
  ]);

  const ranked = league
    ? league.teams
        .map((t) => ({ team: t, ...value(t, ros) }))
        .sort((a, b) => b.total - a.total)
    : [];
  const selected =
    ranked.find((r) => r.team.id === sp.team) ?? ranked[0] ?? null;

  return (
    <>
      <PageHead
      >
        {league ? league.name : "Your league"}
      </PageHead>

      <Deck>
        Connect Sleeper and every tool on the site re-points at your actual roster. Nothing is
        stored — the league in the address bar is the whole of it.
      </Deck>

      <div className="grid gap-3 lg:grid-cols-2 mb-4">
        <form className="panel px-4 py-3.5 flex gap-2 flex-wrap items-end" action="/fantasy/league">
          <div className="w-full">
            <div className="label">Connect Sleeper</div>
            <p className="text-[11.5px] text-ink-3 mt-0.5 mb-2">
              No password — Sleeper&apos;s API is public.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
            <span className="label">Sleeper username</span>
            <input
              name="user"
              defaultValue={username}
              placeholder="username"
              className="h-[30px] px-2 rounded-[3px] border border-rule bg-panel text-[12.5px] w-full"
            />
          </label>
          <button
            type="submit"
            className="h-[30px] px-4 rounded-[3px] border border-navy bg-navy text-white text-[12px]"
          >
            Find my leagues
          </button>
        </form>

        <form className="panel px-4 py-3.5 flex gap-2 flex-wrap items-end" action="/fantasy/league">
          <div className="w-full">
            <div className="label">Or paste a league id</div>
            <p className="text-[11.5px] text-ink-3 mt-0.5 mb-2">
              ESPN has no public sign-in; public leagues only.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="label">Platform</span>
            <select
              name="platform"
              defaultValue={platform}
              className="h-[30px] px-2 rounded-[3px] border border-rule bg-panel text-[12.5px]"
            >
              <option value="sleeper">Sleeper</option>
              <option value="espn">ESPN</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
            <span className="label">League id</span>
            <input
              name="id"
              defaultValue={leagueId}
              placeholder="digits only"
              className="h-[30px] px-2 rounded-[3px] border border-rule bg-panel text-[12.5px] num w-full"
            />
          </label>
          <button
            type="submit"
            className="h-[30px] px-4 rounded-[3px] border border-rule bg-panel text-[12px]"
          >
            Load
          </button>
        </form>
      </div>

      {choices && (
        <Panel
          title={`${choices.display}'s leagues`}
          className="mb-4"
        >
          <div className="p-3 grid gap-2 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
            {choices.leagues.map((l) => (
              <Link
                key={l.id}
                href={`/fantasy/league?platform=sleeper&id=${l.id}`}
                className="border border-rule rounded-[3px] px-3 py-2.5 no-underline text-inherit hover:border-rule-strong transition-colors"
              >
                <div className="text-[12.5px] font-medium">{l.name}</div>
                <div className="text-[11px] text-ink-3 num mt-0.5">
                  {l.teamCount} teams · {l.season}
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}

      {problem && (
        <div className="panel px-4 py-3 mb-4">
          <div className="text-[12.5px] text-ink">{problem.error}</div>
          {problem.hint && <div className="text-[11.5px] text-ink-3 mt-1">{problem.hint}</div>}
        </div>
      )}

      {league && (
        <>
          <div className="flex gap-1.5 flex-wrap mb-4">
            {[
              ["power", "Power rankings"],
              ["allplay", "All-play & luck"],
              ["lineup", "Optimal lineup"],
              ["matchup", "Matchup odds"],
              ["trade", "Trade targets"],
              ["swap", "Trade simulator"],
              ["wire", "Free agents"],
              ["moves", "Recent moves"],
              ["board", "Scoreboard"],
              ["season", "Season summary"],
            ].map(([key, label]) => (
              <Link
                key={key}
                href={`/fantasy/league?platform=${league.platform}&id=${league.id}&team=${selected?.team.id ?? ""}&view=${key}`}
                className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
                  key === view
                    ? "bg-navy border-navy text-white"
                    : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          {view === "lineup" && selected && (
            <LineupPanel
              team={selected.team}
              slots={league.slots}
              proj={proj}
              fits={fits}
              week={week}
            />
          )}

          {view === "matchup" && selected && (
            <MatchupPanel
              league={league}
              a={selected.team}
              b={
                league.teams.find((t) => t.id === sp.vs) ??
                league.teams.find((t) => t.id !== selected.team.id) ??
                selected.team
              }
              proj={proj}
              fits={fits}
              week={week}
            />
          )}

          {view === "matchup" && selected && (
            <div className="flex gap-1 flex-wrap mt-3">
              <span className="label self-center mr-1">Against</span>
              {league.teams
                .filter((t) => t.id !== selected.team.id)
                .map((t) => (
                  <Link
                    key={t.id}
                    href={`/fantasy/league?platform=${league.platform}&id=${league.id}&team=${selected.team.id}&view=matchup&vs=${t.id}`}
                    className={`px-2 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[11.5px] no-underline ${
                      t.id === (sp.vs ?? league.teams.find((x) => x.id !== selected.team.id)?.id)
                        ? "bg-navy border-navy text-white"
                        : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
                    }`}
                  >
                    {t.name}
                  </Link>
                ))}
            </div>
          )}

          {view === "wire" && (
            <FreeAgentPanel league={league} proj={proj} teams={teams} week={week} />
          )}

          {view === "allplay" && <AllPlayPanel rows={allPlay(league, history)} />}

          {view === "trade" && selected && (
            <TradeTargetPanel
              targets={tradeTargets(league, selected.team, proj)}
              teamName={selected.team.name}
            />
          )}

          {view === "swap" && selected && (() => {
            const partner =
              league.teams.find((t) => t.id === sp.vs) ??
              league.teams.find((t) => t.id !== selected.team.id) ??
              selected.team;
            const give = new Set((sp.give ?? "").split(",").filter(Boolean));
            const got = new Set((sp.get ?? "").split(",").filter(Boolean));
            const hrefFor = (patch: { give?: string[]; get?: string[]; vs?: string }) => {
              const q = new URLSearchParams({
                platform: league.platform,
                id: league.id,
                team: selected.team.id,
                view: "swap",
                vs: patch.vs ?? partner.id,
              });
              const g = patch.give ?? [...give];
              const r = patch.get ?? [...got];
              if (g.length) q.set("give", g.join(","));
              if (r.length) q.set("get", r.join(","));
              return `/fantasy/league?${q.toString()}`;
            };
            return (
              <TradeSimulator
                league={league}
                mine={selected.team}
                partner={partner}
                give={give}
                get={got}
                proj={proj}
                hrefFor={hrefFor}
              />
            );
          })()}

          {view === "board" && (
            <>
              <ScoreboardPanel
                league={league}
                history={history}
                week={Number(sp.wk) || Math.max(1, ...history.map((h) => h.week), 1)}
              />
              {history.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-3">
                  <span className="label self-center mr-1">Week</span>
                  {[...new Set(history.map((h) => h.week))]
                    .sort((a, b) => a - b)
                    .map((w) => (
                      <Link
                        key={w}
                        href={`/fantasy/league?platform=${league.platform}&id=${league.id}&view=board&wk=${w}`}
                        className={`num px-2 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[11.5px] no-underline ${
                          w === (Number(sp.wk) || Math.max(...history.map((h) => h.week)))
                            ? "bg-navy border-navy text-white"
                            : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
                        }`}
                      >
                        {w}
                      </Link>
                    ))}
                </div>
              )}
            </>
          )}

          {view === "season" && <SeasonSummaryPanel league={league} history={history} />}

          {view === "moves" && (
            <MovesPanel
              league={league}
              moves={moves}
              nameOf={(sid) =>
                sleeperNames.get(sid) ??
                // A team defence is keyed by club abbreviation and has no
                // nflverse player row, so it never reaches the bridge.
                (/^[A-Z]{2,4}$/.test(sid) ? `${sid} D/ST` : `#${sid}`)
              }
            />
          )}

          <div
            className="grid gap-4 lg:grid-cols-[1.1fr_1fr] items-start"
            style={view === "power" ? undefined : { display: "none" }}
          >
            <Panel title="Power rankings">
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="l">Team</th>
                      <th>Record</th>
                      <th>ROS pts</th>
                      <th title="Players on the roster we could value">Covered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => (
                      <tr
                        key={r.team.id}
                        style={
                          selected?.team.id === r.team.id
                            ? { background: "var(--accent-wash)" }
                            : undefined
                        }
                      >
                        <td className="num text-ink-3">{i + 1}</td>
                        <td className="l">
                          <Link
                            href={`/fantasy/league?platform=${league.platform}&id=${league.id}&team=${r.team.id}`}
                            className="link-cell font-medium"
                          >
                            {r.team.name}
                          </Link>
                          {r.team.owner && r.team.owner !== r.team.name && (
                            <span className="text-ink-3 text-[11px] ml-1.5">{r.team.owner}</span>
                          )}
                        </td>
                        <td className="num text-ink-2">
                          {r.team.wins}–{r.team.losses}
                          {r.team.ties ? `–${r.team.ties}` : ""}
                        </td>
                        <td className="num font-semibold">{num(r.total, 0)}</td>
                        <td className="num text-ink-3">
                          {r.covered}/{r.team.roster.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {selected && (
              <Panel
                title={selected.team.name}
              >
                <div className="scroll-x max-h-[520px] scroll-y">
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th className="l">Player</th>
                        <th className="l">Pos</th>
                        <th className="l">Tm</th>
                        <th>ROS</th>
                        <th>PPG</th>
                        <th className="l">Slot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.rows.map((r, i) => (
                        <tr key={`${r.slot.playerId ?? r.slot.name}-${i}`}>
                          <td className="l">
                            {r.slot.playerId ? (
                              <Link
                                href={`/players/${r.slot.playerId}`}
                                className="link-cell font-medium"
                              >
                                {r.slot.name}
                              </Link>
                            ) : (
                              <span className="text-ink-2">{r.slot.name}</span>
                            )}
                          </td>
                          <td className="l text-ink-3 text-[11.5px]">
                            {r.proj?.position ?? r.slot.position ?? "—"}
                          </td>
                          <td className="l">
                            {r.slot.nflTeam && (
                              <TeamMark
                                team={r.slot.nflTeam}
                                logo={teams[r.slot.nflTeam]?.logo}
                                size={16}
                                showAbbr={false}
                              />
                            )}
                          </td>
                          <td className="num font-semibold">
                            {r.proj ? num(r.proj.ros_points, 0) : "—"}
                          </td>
                          <td className="num text-ink-2">
                            {r.proj ? num(r.proj.ros_ppg, 1) : "—"}
                          </td>
                          <td className="l text-[11px] text-ink-3">
                            {r.slot.starter ? "starter" : "bench"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>

          {league.unmatched > 0 && ["power", "lineup", "matchup", "trade", "swap", "wire"].includes(view) && (
            <div className="panel px-4 py-2.5 mt-4 text-[11.5px] text-ink-2">
              {league.unmatched} rostered {league.unmatched === 1 ? "player has" : "players have"} no
              row in the store and carry no projection. That is almost always a rookie or an
              undrafted free agent who has not taken an NFL snap, so nflverse has nothing on them
              yet — they are listed by name rather than dropped.
            </div>
          )}
        </>
      )}

    </>
  );
}
