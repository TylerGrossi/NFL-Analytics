import Link from "next/link";
import { Deck, Empty, PageHead, Panel, StatRow, StatTile, TeamMark } from "@/components/ui";
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

  const [rows, base, extremes, teams] = await Promise.all([
    getCoachCareers(sort, MIN_GAMES, 60),
    getCoachBaseline(),
    getCoachExtremes(MIN_GAMES),
    getTeamMap(),
    getManifest(),
  ]);

  if (rows.length === 0) {
    return (
      <>
        <PageHead>Coaches</PageHead>
        <Empty>Coach tables have not been built yet. Run the pipeline.</Empty>
      </>
    );
  }

  return (
    <>
      <PageHead>
        Coaches
      </PageHead>

      <Deck>
        Aggressiveness, pass tendency and predictability — followed across every club a coach has
        led, not just his current one.
      </Deck>

      <StatRow className="mb-5">
        <StatTile label="Coaches tracked" value={String(rows.length)} />
        {extremes.unpredictable && (
          <StatTile
            label="Least predictable"
            value={extremes.unpredictable.coach.split(" ").slice(-1)[0]}
          />
        )}
        {extremes.predictable && (
          <StatTile
            label="Most predictable"
            value={extremes.predictable.coach.split(" ").slice(-1)[0]}
          />
        )}
        {extremes.boldest && (
          <StatTile
            label="Boldest on fourth"
            value={extremes.boldest.coach.split(" ").slice(-1)[0]}
          />
        )}
      </StatRow>

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

    </>
  );
}
