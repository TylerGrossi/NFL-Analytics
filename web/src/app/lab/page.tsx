import Link from "next/link";
import { Deck, DivergingBar, Empty, Notes, Panel, SectionRule, TeamMark } from "@/components/ui";
import {
  getBuiltSeasons,
  getManifest,
  getTeamMap,
  runSplitBaseline,
  runSplitQuery,
} from "@/lib/queries";
import {
  FILTERS,
  GROUPINGS,
  activeWhere,
  findGrouping,
  needsCharted,
} from "@/lib/splits";
import { int, num, pct, pts, signed } from "@/lib/format";

export const metadata = { title: "Lab" };
export const revalidate = 300;

const MIN_PLAYS = [25, 50, 100, 250];
const CHARTED_FROM = 2016;

export default async function LabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getBuiltSeasons();
  const newest = seasons[0] ?? manifest.stats_season;
  const oldest = seasons[seasons.length - 1] ?? newest;

  const charted = needsCharted(sp);
  const floor = charted ? Math.max(oldest, CHARTED_FROM) : oldest;

  const rawFrom = Number(sp.from ?? newest);
  const rawTo = Number(sp.to ?? newest);
  const seasonFrom = Math.min(Math.max(rawFrom, floor), newest);
  const seasonTo = Math.min(Math.max(rawTo, seasonFrom), newest);

  const grouping = findGrouping(sp.group);
  const where = activeWhere(sp);
  const minPlays = MIN_PLAYS.includes(Number(sp.min)) ? Number(sp.min) : 50;

  const [rows, baseline, teams] = await Promise.all([
    runSplitQuery({
      charted,
      seasonFrom,
      seasonTo,
      where,
      groupColumn: grouping.column,
      groupIsPlayer: Boolean(grouping.player),
      requires: grouping.requires,
      minPlays,
      limit: 40,
    }),
    runSplitBaseline({ charted, seasonFrom, seasonTo, where, requires: grouping.requires }),
    getTeamMap(),
  ]);

  // Defensive splits read the other way: giving up less EPA is the good outcome.
  const lowerIsBetter = grouping.key === "defense";
  const ordered = lowerIsBetter ? [...rows].reverse() : rows;

  const href = (patch: Record<string, string | number>) => {
    const base: Record<string, string> = {
      group: grouping.key,
      from: String(seasonFrom),
      to: String(seasonTo),
      min: String(minPlays),
    };
    for (const g of FILTERS) {
      const v = sp[g.key];
      if (v && v !== "any") base[g.key] = v;
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === "any") delete base[k];
      else base[k] = String(v);
    }
    return `/lab?${new URLSearchParams(base).toString()}`;
  };

  const chip = (active: boolean, muted = false) =>
    `px-2 py-1 rounded-[3px] border text-[11.5px] no-underline whitespace-nowrap shrink-0 transition-colors ${
      active
        ? "bg-navy border-navy text-white"
        : muted
          ? "bg-panel border-rule text-ink-3 opacity-50"
          : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
    }`;

  const activeCount = FILTERS.filter((g) => (sp[g.key] ?? "any") !== "any").length;

  return (
    <>
      <SectionRule
        aside={
          baseline
            ? `${int(baseline.plays)} plays match · league ${signed(baseline.epa)} EPA`
            : undefined
        }
      >
        Lab
      </SectionRule>

      <Deck>
        Ask your own question of {charted ? "343,000 charted plays" : "1.28 million plays"} — every
        filter runs live against the store.
      </Deck>

      {/* ------------------------------------------------------------ filters */}
      <div className="panel px-3.5 py-3 mb-4 flex flex-col gap-2.5">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="label w-full sm:w-[74px] shrink-0">Group by</span>
          {GROUPINGS.map((g) => (
            <Link key={g.key} href={href({ group: g.key })} className={chip(g.key === grouping.key)}>
              {g.label}
            </Link>
          ))}
        </div>

        {FILTERS.map((g) => {
          const disabled = Boolean(g.charted) && seasonFrom < CHARTED_FROM && !charted;
          return (
            <div key={g.key} className="flex gap-2 items-center flex-wrap">
              <span className="label w-full sm:w-[74px] shrink-0">
                {g.label}
                {g.charted && <span className="text-ink-3 ml-1">*</span>}
              </span>
              {g.options.map((o) => (
                <Link
                  key={o.key}
                  href={href({ [g.key]: o.key })}
                  className={chip((sp[g.key] ?? "any") === o.key, disabled && o.key !== "any")}
                >
                  {o.label}
                </Link>
              ))}
            </div>
          );
        })}

        <div className="flex gap-2 items-center flex-wrap pt-1 border-t border-rule">
          <span className="label w-full sm:w-[74px] shrink-0">Seasons</span>
          {seasons
            .filter((s) => s >= floor)
            .slice(0, 12)
            .map((s) => (
              <Link
                key={s}
                href={href({ from: s, to: s })}
                className={`num ${chip(seasonFrom === s && seasonTo === s)}`}
              >
                {s}
              </Link>
            ))}
          <Link
            href={href({ from: floor, to: newest })}
            className={chip(seasonFrom === floor && seasonTo === newest)}
          >
            All ({floor}–{newest})
          </Link>

          <span className="flex-1" />
          <span className="label">Min plays</span>
          {MIN_PLAYS.map((m) => (
            <Link key={m} href={href({ min: m })} className={`num ${chip(m === minPlays)}`}>
              {m}
            </Link>
          ))}
          {activeCount > 0 && (
            <Link href="/lab" className="text-[11.5px] text-accent no-underline ml-1">
              Reset
            </Link>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ results */}
      <Panel
        title={`${grouping.label} · ${seasonFrom === seasonTo ? seasonFrom : `${seasonFrom}–${seasonTo}`}`}
        meta={
          lowerIsBetter ? "best defenses first — least EPA allowed" : "best first, by EPA per play"
        }
      >
        {ordered.length === 0 ? (
          <Empty>
            Nothing clears {minPlays} plays with these filters. Try loosening one or lowering the
            minimum.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="l">{grouping.player ? "Player" : "Team"}</th>
                  {grouping.player && <th className="l">Tm</th>}
                  <th>Plays</th>
                  <th>EPA/play</th>
                  <th className="w-[90px]">vs league</th>
                  <th>Succ%</th>
                  <th>Expl%</th>
                  <th>Yds</th>
                  <th>CPOE</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r, i) => (
                  <tr key={r.key}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td className="l">
                      {grouping.player ? (
                        <Link href={`/players/${r.key}`} className="link-cell font-medium">
                          {r.name ?? r.key}
                        </Link>
                      ) : (
                        <TeamMark
                          team={r.key}
                          logo={teams[r.key]?.logo}
                          href={`/teams/${r.key}`}
                          name={teams[r.key]?.nick ?? r.key}
                        />
                      )}
                    </td>
                    {grouping.player && (
                      <td className="l">
                        {r.team && (
                          <TeamMark
                            team={r.team}
                            logo={teams[r.team]?.logo}
                            size={16}
                            showAbbr={false}
                          />
                        )}
                      </td>
                    )}
                    <td className="num text-ink-2">{int(r.plays)}</td>
                    <td className="num font-semibold">{signed(r.epa)}</td>
                    <td>
                      <DivergingBar
                        value={r.epa - (baseline?.epa ?? 0)}
                        max={0.4}
                      />
                    </td>
                    <td className="num text-ink-2">{pct(r.success, 0)}</td>
                    <td className="num text-ink-2">{pct(r.explosive, 0)}</td>
                    <td className="num text-ink-2">{num(r.yards, 1)}</td>
                    <td className="num text-ink-2">
                      {r.cpoe === null ? "—" : pts(r.cpoe)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Notes>
        <p>
          Nothing is precomputed, so any combination of filters is fair game — third and long from
          the red zone, 12 personnel against man coverage, whatever you want.
        </p>
        <p>
          <b>*</b> Formation, personnel, coverage and pressure come from charted participation data
          and only exist from {CHARTED_FROM}; selecting one narrows the season range automatically.
          Everything else reaches back to {oldest}.
        </p>
        <p>
          The bar compares each row to the league average <em>for the same split</em>, not to the
          league overall — a red zone leaderboard is judged against red zone offence, which is the
          comparison that means something.
        </p>
      </Notes>
    </>
  );
}
