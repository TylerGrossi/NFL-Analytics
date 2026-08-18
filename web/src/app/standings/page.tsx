import Link from "next/link";
import { Panel, RankChip, SectionRule, TeamMark } from "@/components/ui";
import { SeasonNav } from "@/components/SeasonNav";
import {
  getBuiltSeasons,
  getManifest,
  getStandings,
  getTeamMap,
  type StandingsRow,
} from "@/lib/queries";
import { num, signed } from "@/lib/format";

export const metadata = { title: "Standings" };
export const revalidate = 300;

const DIVISION_ORDER = ["East", "North", "South", "West"];
const CONFS = ["AFC", "NFC"] as const;

const VIEWS = [
  ["division", "Division"],
  ["playoffs", "Playoff Picture"],
  ["league", "League"],
] as const;

type View = (typeof VIEWS)[number][0];

type TeamMeta = Record<string, { logo?: string | null; nick?: string } | undefined>;

/**
 * The name cell, shared by all three views.
 *
 * The seed sits in a fixed-width slot to the left rather than in a column of
 * its own: in the division tables only four of sixteen rows carry one, and a
 * column that is empty three quarters of the time costs more width than the
 * figure is worth.
 */
function TeamCell({
  row,
  teams,
  seed,
}: {
  row: StandingsRow;
  teams: TeamMeta;
  seed?: boolean;
}) {
  return (
    <td>
      <span className="flex items-center gap-2">
        {seed && (
          <span
            className="num text-[10px] w-[16px] text-ink-3 shrink-0"
            title={row.in_playoffs ? `Seed ${row.seed}` : "Out"}
          >
            {row.in_playoffs ? row.seed : ""}
          </span>
        )}
        <TeamMark
          team={row.team}
          logo={teams[row.team]?.logo}
          href={`/teams/${row.team}`}
          /* The map is resolved for the season being shown, so it carries the
             club's name that year; the standings row carries today's. */
          name={teams[row.team]?.nick ?? row.nick ?? row.team}
        />
      </span>
    </td>
  );
}

/**
 * A streak sorts on its direction first, its length second.
 *
 * The column reads "W9" or "L2", and the sorter's fallback pulls the digits
 * out of the text — which ranked a two-game losing streak above a one-game
 * winning one. Signing the length puts every W above every L.
 */
function Streak({ v }: { v: string }) {
  const n = Number(v.replace(/\D/g, "")) || 0;
  const sort = v.startsWith("W") ? n : v.startsWith("L") ? -n : 0;
  return (
    <td className="num text-ink-2" data-sort={sort}>
      {v}
    </td>
  );
}

function Diff({ v }: { v: number }) {
  return <td className={`num ${v >= 0 ? "text-pos" : "text-neg"}`}>{signed(v, 0)}</td>;
}

function Luck({ v }: { v: number }) {
  return <td className={`num ${v >= 0 ? "text-pos" : "text-neg"}`}>{signed(v, 1)}</td>;
}

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getBuiltSeasons();
  const season = Number(sp.season ?? manifest.stats_season);
  const view: View = VIEWS.some(([k]) => k === sp.view) ? (sp.view as View) : "division";
  const [rows, teams] = await Promise.all([getStandings(season), getTeamMap(season)]);

  // A tie column that is zero for all 32 teams is 34px of nothing in every one
  // of the eight division tables — most seasons have none.
  const hasTies = rows.some((r) => r.t > 0);

  const byConf: Record<string, Record<string, StandingsRow[]>> = {};
  for (const r of rows) {
    const conf = r.conf ?? "—";
    const div = (r.division ?? "").replace(`${conf} `, "");
    byConf[conf] ??= {};
    byConf[conf][div] ??= [];
    byConf[conf][div].push(r);
  }
  for (const divs of Object.values(byConf)) {
    for (const list of Object.values(divs)) list.sort((a, b) => a.div_place - b.div_place);
  }

  const seeded: Record<string, StandingsRow[]> = {};
  for (const conf of CONFS) {
    seeded[conf] = rows.filter((r) => r.conf === conf).sort((a, b) => a.seed - b.seed);
  }

  const league = [...rows].sort((a, b) => b.pct - a.pct || b.diff - a.diff);

  return (
    <>
      <SectionRule>Standings</SectionRule>

      <div className="flex items-center gap-4 flex-wrap mb-4">
        <SeasonNav
          seasons={seasons}
          active={season}
          href={(s) => `/standings?season=${s}&view=${view}`}
          inline
        />
        {/* Same 30px box as the season select, so the row reads as one strip of
            controls rather than two that happen to sit near each other. */}
        <div className="flex gap-1.5 flex-wrap">
          {VIEWS.map(([key, label]) => (
            <Link
              key={key}
              href={`/standings?season=${season}&view=${key}`}
              aria-current={key === view ? "page" : undefined}
              className={`inline-flex items-center h-[30px] px-3 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
                key === view
                  ? "bg-navy border-navy text-white"
                  : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {view === "division" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {CONFS.map((conf) => (
            <div key={conf} className="flex flex-col gap-4">
              {DIVISION_ORDER.map((div) => {
                const list = byConf[conf]?.[div];
                if (!list?.length) return null;
                return (
                  <Panel key={div} title={`${conf} ${div}`}>
                    <div className="scroll-x">
                      <table className="grid-table">
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th>W</th>
                            <th>L</th>
                            {hasTies && <th>T</th>}
                            <th>Diff</th>
                            <th>xWins</th>
                            <th>Luck</th>
                            <th>Off</th>
                            <th>Def</th>
                            <th>Net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r) => (
                            <tr key={r.team}>
                              <TeamCell row={r} teams={teams} seed />
                              <td className="num font-semibold">{r.w}</td>
                              <td className="num">{r.l}</td>
                              {hasTies && <td className="num text-ink-3">{r.t}</td>}
                              <Diff v={r.diff} />
                              <td className="num text-ink-2">{num(r.pyth_w, 1)}</td>
                              <Luck v={r.luck} />
                              <td>
                                <RankChip rank={r.off_rank} />
                              </td>
                              <td>
                                <RankChip rank={r.def_rank} />
                              </td>
                              <td className="num font-semibold">{signed(r.net_adj)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {view === "playoffs" && (
        <div className="grid gap-4 xl:grid-cols-2">
          {CONFS.map((conf) => (
            <Panel key={conf} title={conf}>
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Sd</th>
                      <th>Team</th>
                      <th>W</th>
                      <th>L</th>
                      {hasTies && <th>T</th>}
                      <th>Div</th>
                      <th>Conf</th>
                      <th>Diff</th>
                      <th>Net</th>
                      <th>Strk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seeded[conf]?.map((r, i) => (
                      <tr
                        key={r.team}
                        /* The cut line is the only thing this view exists to
                           show, so it is drawn on the table rather than left
                           to the reader counting rows. It follows the last
                           qualifier rather than a fixed row, because the field
                           was six a side before 2020. `globals.css` hides it
                           while the table is sorted by something else. */
                        data-cut={
                          !r.in_playoffs && seeded[conf]?.[i - 1]?.in_playoffs ? "" : undefined
                        }
                      >
                        <td className="num text-ink-3">{r.seed}</td>
                        <TeamCell row={r} teams={teams} />
                        <td className="num font-semibold">{r.w}</td>
                        <td className="num">{r.l}</td>
                        {hasTies && <td className="num text-ink-3">{r.t}</td>}
                        <td className="num text-ink-2">
                          {r.div_w}-{r.div_l}
                        </td>
                        <td className="num text-ink-2">
                          {r.conf_w}-{r.conf_l}
                        </td>
                        <Diff v={r.diff} />
                        <td className="num font-semibold">{signed(r.net_adj)}</td>
                        <Streak v={r.streak} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {view === "league" && (
        <Panel>
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="l">Div</th>
                  <th>W</th>
                  <th>L</th>
                  {hasTies && <th>T</th>}
                  <th>PF</th>
                  <th>PA</th>
                  <th>Diff</th>
                  <th>xWins</th>
                  <th>Luck</th>
                  <th>Off</th>
                  <th>Def</th>
                  <th>Net</th>
                  <th>SoS</th>
                  <th>Strk</th>
                </tr>
              </thead>
              <tbody>
                {league.map((r, i) => (
                  <tr key={r.team}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <TeamCell row={r} teams={teams} />
                    <td className="l text-ink-3 text-[11.5px]">{r.division}</td>
                    <td className="num font-semibold">{r.w}</td>
                    <td className="num">{r.l}</td>
                    {hasTies && <td className="num text-ink-3">{r.t}</td>}
                    <td className="num text-ink-2">{r.pf}</td>
                    <td className="num text-ink-2">{r.pa}</td>
                    <Diff v={r.diff} />
                    <td className="num text-ink-2">{num(r.pyth_w, 1)}</td>
                    <Luck v={r.luck} />
                    <td>
                      <RankChip rank={r.off_rank} />
                    </td>
                    <td>
                      <RankChip rank={r.def_rank} />
                    </td>
                    <td className="num font-semibold">{signed(r.net_adj)}</td>
                    <td className="num text-ink-3">{signed(r.sos)}</td>
                    <Streak v={r.streak} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
