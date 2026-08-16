import { Deck, Notes, Panel, RankChip, SectionRule, TeamMark } from "@/components/ui";
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

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getBuiltSeasons();
  const season = Number(sp.season ?? manifest.stats_season);
  const [rows, teams] = await Promise.all([getStandings(season), getTeamMap()]);

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

  return (
    <>
      <SectionRule aside={`${season} regular season`}>Standings</SectionRule>

      <SeasonNav
        seasons={seasons}
        active={season}
        href={(s) => `/standings?season=${s}`}
      />

      <Deck>
        <b>Pyth</b> expected wins · <b>Luck</b> actual minus expected · <b>Net</b> opponent-adjusted
        EPA · <b>SoS</b> average opponent net.
      </Deck>

      <div className="grid gap-4 xl:grid-cols-2">
        {["AFC", "NFC"].map((conf) => (
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
                          <th>T</th>
                          <th>PF</th>
                          <th>PA</th>
                          <th>Diff</th>
                          <th>Pyth</th>
                          <th>Luck</th>
                          <th>Off</th>
                          <th>Def</th>
                          <th>Net</th>
                          <th>SoS</th>
                          <th>Strk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((r) => (
                          <tr key={r.team}>
                            <td>
                              <span className="flex items-center gap-2">
                                <span
                                  className="num text-[10px] w-[16px] text-ink-3 shrink-0"
                                  title={r.in_playoffs ? `Seed ${r.seed}` : "Out"}
                                >
                                  {r.in_playoffs ? r.seed : ""}
                                </span>
                                <TeamMark
                                  team={r.team}
                                  logo={teams[r.team]?.logo}
                                  href={`/teams/${r.team}`}
                                  name={r.nick ?? r.team}
                                />
                              </span>
                            </td>
                            <td className="num font-semibold">{r.w}</td>
                            <td className="num">{r.l}</td>
                            <td className="num text-ink-3">{r.t}</td>
                            <td className="num text-ink-2">{r.pf}</td>
                            <td className="num text-ink-2">{r.pa}</td>
                            <td className={`num ${r.diff >= 0 ? "text-pos" : "text-neg"}`}>
                              {signed(r.diff, 0)}
                            </td>
                            <td className="num text-ink-2">{num(r.pyth_w, 1)}</td>
                            <td className={`num ${r.luck >= 0 ? "text-pos" : "text-neg"}`}>
                              {signed(r.luck, 1)}
                            </td>
                            <td>
                              <RankChip rank={r.off_rank} />
                            </td>
                            <td>
                              <RankChip rank={r.def_rank} />
                            </td>
                            <td className="num font-semibold">{signed(r.net_adj)}</td>
                            <td className="num text-ink-3">{signed(r.sos)}</td>
                            <td className="num text-ink-2">{r.streak}</td>
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

      <Notes>
        <p>
          <b>Pyth</b> is expected wins from point differential and <b>Luck</b> is actual wins minus
          that, so a positive figure is a club winning more than its scoring says it should.{" "}
          <b>Net</b> is opponent-adjusted EPA per play; <b>SoS</b> is the average opponent&apos;s net
          rating.
        </p>
        <p>
          Seeds come from the full NFL tiebreaker tree — head to head, division and conference
          record, common games, strength of victory — which reproduces every playoff field from
          1999 on exactly.
        </p>
      </Notes>
    </>
  );
}
