import Link from "next/link";
import { Empty, Panel, SectionRule, TeamMark } from "@/components/ui";
import type {
  DepthRow,
  InjuryRow,
  CoverageRow,
  GamePreview as PreviewRow,
  SeparationRow,
  Team,
  TeamSeason,
} from "@/lib/queries";
import { gameDate, num, pct, signed } from "@/lib/format";
import { distinguishTeamColors } from "@/lib/colors";

type Side = {
  abbr: string;
  meta?: Team;
  season: TeamSeason | null;
  receivers: SeparationRow[];
  coverage: CoverageRow[];
  depth: DepthRow[];
  injuries: InjuryRow[];
};

/** Rows of the head-to-head comparison, with the sense of "better" declared. */
const UNITS: {
  label: string;
  pick: (t: TeamSeason) => number | null;
  fmt: (v: number) => string;
  higherIsBetter: boolean;
  rank?: (t: TeamSeason) => number | null;
}[] = [
  { label: "Offense EPA/play", pick: (t) => t.off_adj, fmt: (v) => signed(v), higherIsBetter: true, rank: (t) => t.off_rank },
  { label: "Defense EPA/play", pick: (t) => t.def_adj, fmt: (v) => signed(v), higherIsBetter: false, rank: (t) => t.def_rank },
  { label: "Pass EPA/play", pick: (t) => t.off_pass_epa as number, fmt: (v) => signed(v), higherIsBetter: true },
  { label: "Rush EPA/play", pick: (t) => t.off_rush_epa as number, fmt: (v) => signed(v), higherIsBetter: true },
  { label: "Success rate", pick: (t) => t.off_success as number, fmt: (v) => pct(v, 1), higherIsBetter: true },
  { label: "Explosive rate", pick: (t) => t.off_explosive_rate as number, fmt: (v) => pct(v, 1), higherIsBetter: true },
  { label: "Points / drive", pick: (t) => t.off_points_per_drive as number, fmt: (v) => num(v, 2), higherIsBetter: true },
  { label: "Pass rate over expected", pick: (t) => t.neutral_proe as number, fmt: (v) => signed(v, 1), higherIsBetter: true },
];

export function GamePreview({
  preview,
  home,
  away,
  ratingSeason,
}: {
  preview: PreviewRow;
  home: Side;
  away: Side;
  /** The season the ratings come from — not necessarily the season being played. */
  ratingSeason: number;
}) {
  // Two navy clubs otherwise render as one solid bar.
  const colors = distinguishTeamColors(home.meta ?? {}, away.meta ?? {});
  const homeFavored = preview.proj_margin >= 0;
  const favorite = homeFavored ? home : away;
  const homePct = Math.round(preview.home_wp * 100);

  // The model's own line, stated the way a line is stated.
  const modelLine = `${favorite.abbr} ${signed(-Math.abs(preview.proj_margin), 1)}`;
  const marketLine =
    preview.spread_line === null
      ? null
      : `${preview.spread_line >= 0 ? home.abbr : away.abbr} ${signed(-Math.abs(preview.spread_line), 1)}`;

  return (
    <>
      <SectionRule aside={<Link href="/scores" className="text-accent">All scores</Link>}>
        {away.meta?.name ?? away.abbr} at {home.meta?.name ?? home.abbr}
      </SectionRule>

      <div className="panel overflow-hidden mb-4">
        <div className="flex items-center justify-between px-4 py-2 border-b border-rule bg-panel-2 text-[11px] flex-wrap gap-2">
          <span className="label">
            Week {preview.week} · {preview.season}
          </span>
          <span className="text-ink-3 num">
            {gameDate(preview.gameday)}
            {preview.gametime ? ` · ${preview.gametime.slice(0, 5)}` : ""}
          </span>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 px-3 sm:px-5 py-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <TeamMark team={away.abbr} logo={away.meta?.logo} size={38} showAbbr={false} href={`/teams/${away.abbr}`} />
            <div className="min-w-0">
              <div className="font-semibold text-[14px]">
                <span className="hidden sm:inline">{away.meta?.nick ?? away.abbr}</span>
                <span className="sm:hidden">{away.abbr}</span>
              </div>
              <div className="text-[11px] text-ink-3">projected</div>
            </div>
          </div>
          <div className="text-center">
            <div className="num text-[28px] sm:text-[34px] font-semibold leading-none whitespace-nowrap text-ink-2">
              {preview.proj_away_score.toFixed(0)}
              <span className="text-ink-3 mx-1.5 sm:mx-2">–</span>
              {preview.proj_home_score.toFixed(0)}
            </div>
            <div className="text-[11px] text-ink-3 mt-1">projection</div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-row-reverse text-right min-w-0">
            <TeamMark team={home.abbr} logo={home.meta?.logo} size={38} showAbbr={false} href={`/teams/${home.abbr}`} />
            <div className="min-w-0">
              <div className="font-semibold text-[14px]">
                <span className="hidden sm:inline">{home.meta?.nick ?? home.abbr}</span>
                <span className="sm:hidden">{home.abbr}</span>
              </div>
              <div className="text-[11px] text-ink-3">projected</div>
            </div>
          </div>
        </div>

        {/* Win probability as a single split bar, away on the left as on the scoreboard. */}
        <div className="px-4 sm:px-5 pb-4">
          <div className="flex items-center justify-between text-[11.5px] mb-1.5">
            <span className="num font-semibold" style={{ color: "var(--ink-2)" }}>
              {100 - homePct}%
            </span>
            <span className="label">win probability</span>
            <span className="num font-semibold" style={{ color: "var(--ink)" }}>
              {homePct}%
            </span>
          </div>
          <div className="flex h-[9px] gap-[2px]">
            <div
              className="rounded-[2px]"
              style={{ width: `${100 - homePct}%`, background: colors.away }}
            />
            <div
              className="rounded-[2px]"
              style={{ width: `${homePct}%`, background: colors.home }}
            />
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-rule bg-panel-2 flex items-center justify-between text-[11.5px] flex-wrap gap-x-5 gap-y-1">
          <span className="text-ink-3">
            Model line <b className="num text-ink-2">{modelLine}</b> · total{" "}
            <b className="num text-ink-2">{preview.proj_total.toFixed(1)}</b>
          </span>
          {marketLine ? (
            <span className="text-ink-3">
              Market <b className="num text-ink-2">{marketLine}</b>
              {preview.total_line !== null && (
                <> · total <b className="num text-ink-2">{preview.total_line}</b></>
              )}
            </span>
          ) : (
            <span className="text-ink-3">No market line posted yet</span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr] items-start">
        <Panel title="Head to head">
          {!home.season || !away.season ? (
            <Empty>No rated season for one of these clubs.</Empty>
          ) : (
            <div className="px-1 py-1">
              {UNITS.map((u) => {
                const a = u.pick(away.season!);
                const h = u.pick(home.season!);
                if (a === null || h === null) return null;
                const awayBetter = u.higherIsBetter ? a > h : a < h;
                const span = Math.abs(a) + Math.abs(h) || 1;
                const awayShare = Math.max(8, Math.min(92, (Math.abs(a) / span) * 100));
                return (
                  <div key={u.label} className="px-3 py-2 border-b border-rule last:border-0">
                    <div className="flex items-center justify-between text-[12px] mb-1.5 gap-2">
                      <b className={`num ${awayBetter ? "text-ink" : "text-ink-3"}`}>
                        {u.fmt(a)}
                        {u.rank && <span className="text-ink-3 ml-1 text-[10.5px]">#{u.rank(away.season!)}</span>}
                      </b>
                      <span className="text-ink-3 text-[11px] text-center">{u.label}</span>
                      <b className={`num ${awayBetter ? "text-ink-3" : "text-ink"}`}>
                        {u.rank && <span className="text-ink-3 mr-1 text-[10.5px]">#{u.rank(home.season!)}</span>}
                        {u.fmt(h)}
                      </b>
                    </div>
                    <div className="flex h-[6px] gap-[2px]">
                      <div
                        className="rounded-[2px]"
                        style={{ width: `${awayShare}%`, background: colors.away }}
                      />
                      <div
                        className="rounded-[2px]"
                        style={{ width: `${100 - awayShare}%`, background: colors.home }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between px-3 pt-2 pb-1 text-[11px] text-ink-3">
                <span>{away.abbr}</span>
                <span>{home.abbr}</span>
              </div>
            </div>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Matchup
            title={`${away.abbr} receivers vs ${home.abbr} coverage`}
            receivers={away.receivers}
            defenders={home.coverage}
          />
          <Matchup
            title={`${home.abbr} receivers vs ${away.abbr} coverage`}
            receivers={home.receivers}
            defenders={away.coverage}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start mt-4">
        <Personnel side={away} />
        <Personnel side={home} />
      </div>

      <div className="text-[11.5px] text-ink-3 mt-4 max-w-[92ch] leading-relaxed">
        The projection blends last season&apos;s opponent-adjusted rating with this season&apos;s
        scoring margin, weighted <span className="num">n / (n + 8)</span> in games played
        {preview.games_used > 0 ? (
          <> — {preview.games_used} so far, so the carried rating still holds{" "}
            <span className="num">{Math.round(preview.carry_weight * 100)}%</span> of the weight.</>
        ) : (
          <> — none yet, so it rests entirely on {ratingSeason}.</>
        )}{" "}
        Across 5,455 games from 2005 on, fit only on prior seasons, it lands within 13.6 points RMSE
        of the actual margin and picks 64.2% of winners straight up. The closing line does better:
        13.2 and 66.8%. It knows nothing about who is injured, who was signed in March or who is
        starting at quarterback.
      </div>
    </>
  );
}

/** Best separation against best coverage — the comparison the two scores exist for. */
function Matchup({
  title,
  receivers,
  defenders,
}: {
  title: string;
  receivers: SeparationRow[];
  defenders: CoverageRow[];
}) {
  const rows = Math.max(receivers.length, defenders.length);
  return (
    <Panel title={title}>
      {rows === 0 ? (
        <Empty>No charted receivers or coverage defenders for these clubs.</Empty>
      ) : (
        <div className="px-3 py-1">
          {Array.from({ length: rows }).map((_, i) => {
            const r = receivers[i];
            const d = defenders[i];
            return (
              <div
                key={i}
                className="grid grid-cols-2 gap-3 py-2 border-b border-rule last:border-0 text-[12px]"
              >
                <div className="min-w-0">
                  {r ? (
                    <Link href={`/players/${r.player_id}`} className="link-cell block truncate">
                      <span className="font-medium">{r.name}</span>
                      <span className="num text-ink-3 ml-1.5">{signed(r.separation_score, 1)}</span>
                    </Link>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </div>
                <div className="min-w-0 text-right">
                  {d ? (
                    <span className="block truncate">
                      <span className="num text-ink-3 mr-1.5">{signed(d.coverage_score, 1)}</span>
                      <span className="font-medium">{d.name}</span>
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}


/** Who is expected to play, and who might not. */
function Personnel({ side }: { side: Side }) {
  const byPos = ["QB", "RB", "WR", "TE"]
    .map((pos) => ({ pos, men: side.depth.filter((d) => d.depth_pos === pos) }))
    .filter((g) => g.men.length > 0);
  const doubtful = side.injuries.filter((i) => (i.p_play ?? 1) < 0.95);

  if (byPos.length === 0 && doubtful.length === 0) return null;

  return (
    <Panel
      title={`${side.meta?.nick ?? side.abbr} personnel`}
    >
      <div className="px-4 py-3 flex flex-col gap-2.5">
        {byPos.map((g) => (
          <div key={g.pos} className="flex gap-2 text-[12.5px]">
            <span className="label w-[26px] shrink-0">{g.pos}</span>
            <span className="flex-1 text-ink-2">
              {g.men.map((m, i) => (
                <span key={m.player_id}>
                  {i > 0 && <span className="text-ink-3"> · </span>}
                  <Link href={`/players/${m.player_id}`} className="link-cell">
                    {m.name ?? m.player_id}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>

      {doubtful.length > 0 && (
        <div className="border-t border-rule px-4 py-2.5">
          <div className="label mb-1.5">Injury report</div>
          <div className="flex flex-col gap-1">
            {doubtful.slice(0, 6).map((i) => (
              <div key={i.player_id} className="flex items-baseline gap-2 text-[12px]">
                <span className="flex-1 truncate">
                  <Link href={`/players/${i.player_id}`} className="link-cell">
                    {i.name ?? i.player_id}
                  </Link>
                  <span className="text-ink-3 ml-1.5 text-[11px]">
                    {i.position} · {i.status}
                    {i.injury ? ` (${i.injury.toLowerCase()})` : ""}
                  </span>
                </span>
                <span
                  className={`num font-semibold shrink-0 ${
                    (i.p_play ?? 0) >= 0.7 ? "text-ink-2" : (i.p_play ?? 0) >= 0.3 ? "text-flag" : "text-neg"
                  }`}
                >
                  {i.p_play === null ? "—" : `${Math.round(i.p_play * 100)}%`}
                </span>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-ink-3 mt-2 leading-relaxed">
            Chance of playing, measured from 43,000 reports since 2018 — the designation crossed with
            practice participation, which carries more than the designation does.
          </div>
        </div>
      )}
    </Panel>
  );
}
