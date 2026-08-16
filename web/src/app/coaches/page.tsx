import Link from "next/link";
import { Deck, Empty, Notes, Panel, SectionRule, StatTile, TeamMark } from "@/components/ui";
import {
  getCoachBaseline,
  getCoachCareers,
  getCoachExtremes,
  getManifest,
  getTeamMap,
} from "@/lib/queries";
import { num, pct, signed } from "@/lib/format";

export const metadata = { title: "Coaches" };
export const revalidate = 900;

const SORTS = [
  { key: "games", label: "Most games" },
  { key: "wins", label: "Win rate" },
  { key: "aggressive", label: "Most aggressive" },
  { key: "conservative", label: "Most conservative" },
  { key: "unpredictable", label: "Least predictable" },
  { key: "predictable", label: "Most predictable" },
  { key: "pass", label: "Most pass-happy" },
  { key: "run", label: "Most run-heavy" },
  { key: "tempo", label: "Fastest tempo" },
];

const MIN_GAMES = 32;

export default async function CoachesPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const sp = await searchParams;
  const sort = SORTS.find((s) => s.key === sp.sort)?.key ?? "games";

  const [rows, base, extremes, teams, manifest] = await Promise.all([
    getCoachCareers(sort, MIN_GAMES, 60),
    getCoachBaseline(),
    getCoachExtremes(MIN_GAMES),
    getTeamMap(),
    getManifest(),
  ]);

  if (rows.length === 0) {
    return (
      <>
        <SectionRule>Coaches</SectionRule>
        <Empty>Coach tables have not been built yet. Run the pipeline.</Empty>
      </>
    );
  }

  return (
    <>
      <SectionRule aside={`1999–${manifest.stats_season} · ${MIN_GAMES}+ games`}>
        Coaches
      </SectionRule>

      <Deck>
        Aggressiveness, pass tendency and predictability — followed across every club a coach has
        led, not just his current one.
      </Deck>

      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(190px,1fr))] mb-4">
        <StatTile label="Coaches tracked" value={String(rows.length)} meta={`${MIN_GAMES}+ games`} />
        {extremes.unpredictable && (
          <StatTile
            label="Least predictable"
            value={extremes.unpredictable.coach.split(" ").slice(-1)[0]}
            meta={`${num(extremes.unpredictable.value, 3)} bits of play-call entropy`}
          />
        )}
        {extremes.predictable && (
          <StatTile
            label="Most predictable"
            value={extremes.predictable.coach.split(" ").slice(-1)[0]}
            meta={`${num(extremes.predictable.value, 3)} bits`}
          />
        )}
        {extremes.boldest && (
          <StatTile
            label="Boldest on fourth"
            value={extremes.boldest.coach.split(" ").slice(-1)[0]}
            meta={`goes ${pct(extremes.boldest.value, 0)} of the time the model says go`}
          />
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={`/coaches?sort=${s.key}`}
            className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              s.key === sort
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      <Panel
        title="Career records"
        meta="rates weighted by snaps · league average in the last row"
      >
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Coach</th>
                <th className="l">Last club</th>
                <th>Seasons</th>
                <th>Record</th>
                <th>Win%</th>
                <th title="Pass rate over expected in neutral game states">PROE</th>
                <th title="Binary entropy of the pass/run split by down and distance — 1.0 is a coin flip, 0 is fully predictable">
                  Entropy
                </th>
                <th title="Share of fourth downs the model says go where the coach went">
                  Go when optimal
                </th>
                <th title="Win probability surrendered to fourth-down decisions, per season">
                  WP lost
                </th>
                <th>No huddle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.coach}>
                  <td className="l font-medium">{r.coach}</td>
                  <td className="l">
                    <TeamMark
                      team={r.last_team}
                      logo={teams[r.last_team]?.logo}
                      size={16}
                      href={`/teams/${r.last_team}`}
                    />
                    {r.clubs > 1 && (
                      <span className="text-ink-3 text-[11px] ml-1.5">+{r.clubs - 1}</span>
                    )}
                  </td>
                  <td className="num text-ink-3">{r.seasons}</td>
                  <td className="num text-ink-2">
                    {r.wins}–{r.losses}
                    {r.ties ? `–${r.ties}` : ""}
                  </td>
                  <td className="num font-semibold">{pct(r.win_pct, 1)}</td>
                  <td
                    className="num"
                    style={{
                      color:
                        r.proe === null
                          ? undefined
                          : r.proe > 2
                            ? "var(--c1)"
                            : r.proe < -2
                              ? "var(--c2)"
                              : undefined,
                    }}
                  >
                    {r.proe === null ? "—" : signed(r.proe, 1)}
                  </td>
                  <td className="num">{num(r.entropy, 3)}</td>
                  <td className="num text-ink-2">{pct(r.go_rate_when_optimal, 0)}</td>
                  <td className="num text-ink-2">
                    {r.wp_lost === null ? "—" : num(r.wp_lost / Math.max(r.seasons, 1), 1)}
                  </td>
                  <td className="num text-ink-3">{pct(r.no_huddle_rate, 1)}</td>
                </tr>
              ))}
              {Object.keys(base).length > 0 && (
                <tr style={{ borderTop: "2px solid var(--rule-strong)" }}>
                  <td className="l text-ink-3">League average</td>
                  <td className="l" />
                  <td className="num" />
                  <td className="num" />
                  <td className="num" />
                  <td className="num text-ink-3">{signed(base.proe, 1)}</td>
                  <td className="num text-ink-3">{num(base.entropy, 3)}</td>
                  <td className="num text-ink-3">{pct(base.go_rate_when_optimal, 0)}</td>
                  <td className="num" />
                  <td className="num text-ink-3">{pct(base.no_huddle_rate, 1)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Notes>
        <p>
          <b>Play-call entropy</b> is the measurement here that does not exist elsewhere. For each
          down and distance bucket — short, medium, long — take the coach&apos;s pass/run split and
          compute its binary entropy in bits, then average the cells weighted by how often each
          comes up. A coach who runs every first-and-ten and throws every third-and-long scores
          near 0; one splitting 50/50 everywhere scores 1.0.
        </p>
        <p>
          It measures <em>predictability, not quality</em>, and the two come apart: a coach can be
          highly predictable because he is committed to something that works. Read it beside the
          win rate rather than instead of it.
        </p>
        <p>
          <b>Neutral game states only.</b> Everything except the record is computed from snaps with
          win probability between 20% and 80%. A coach down twenty-one in the fourth is not calling
          the game he wants to, and including those snaps makes every trailing team look pass-happy
          and unpredictable.
        </p>
        <p>
          <b>Rates are weighted by snaps</b>, not averaged across seasons, so a seventeen-game year
          does not count the same as a three-week interim spell. Coaches need {MIN_GAMES} career
          games to appear. <b>WP lost</b> is win probability surrendered to fourth-down decisions
          the model disagreed with, per season — and the fourth-down model does not know personnel,
          so a coach with a backup quarterback is charged the league-average conversion rate.
        </p>
      </Notes>
    </>
  );
}
