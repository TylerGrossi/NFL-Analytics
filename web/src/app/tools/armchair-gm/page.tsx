import Link from "next/link";
import { ArmchairGM } from "@/components/ArmchairGM";
import { Deck, Empty, Notes, Panel, PageHead, TeamMark } from "@/components/ui";
import {
  getCapSummary,
  getCapTable,
  getManifest,
  getSurplusValue,
  getTeamDepth,
  getTeamMap,
} from "@/lib/queries";
import { num } from "@/lib/format";

export const metadata = { title: "Armchair GM" };
export const revalidate = 300;

export default async function ArmchairGmPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const season = manifest.scheduled_season;
  const warSeason = manifest.stats_season;

  const [summary, teams] = await Promise.all([getCapSummary(season), getTeamMap()]);
  // Default to the fullest sheet; the emptiest one is just a team whose
  // contracts mostly expire before this league year, which reads as misleading.
  const fullest = [...summary].sort((a, b) => b.contracts - a.contracts)[0]?.team;
  const team = (sp.team ?? fullest ?? "KC").toUpperCase();
  const chips = [...summary].sort((a, b) => a.team.localeCompare(b.team));
  const teamSummary = summary.find((s) => s.team === team);

  const [rows, surplus, depth] = await Promise.all([
    getCapTable(team, season, warSeason),
    getSurplusValue(season, warSeason, 15),
    getTeamDepth(team, season, warSeason),
  ]);

  return (
    <>
      <PageHead aside={`${season} league year · cap $${num(teamSummary?.cap_limit ?? 0, 1)}M`}>
        Armchair GM
      </PageHead>

      <Deck>
        Cut or restructure anyone and every total moves with it — real Over The Cap accounting, with
        the depth chart reacting underneath.
      </Deck>

      <div className="flex gap-1 flex-wrap mb-4">
        {chips.map((s) => (
          <Link
            key={s.team}
            href={`/tools/armchair-gm?team=${s.team}`}
            className={`px-2 py-1 rounded-[3px] border whitespace-nowrap shrink-0 text-[11.5px] no-underline transition-colors ${
              s.team === team
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {s.team}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>No contracts stored for this team.</Empty>
      ) : (
        <ArmchairGM
          rows={rows}
          depth={depth}
          capLimit={teamSummary?.cap_limit ?? 0}
          team={teams[team]?.nick ?? team}
          season={season}
          warSeason={warSeason}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2 mt-7">
        <Panel title="Best value contracts" meta={`league-wide · PAR per $10M of ${season} cap`}>
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="l">Player</th>
                  <th className="l">Pos</th>
                  <th className="l">Tm</th>
                  <th>Cap hit</th>
                  <th>PAR</th>
                  <th>PAR/$10M</th>
                </tr>
              </thead>
              <tbody>
                {surplus.map((s, i) => (
                  <tr key={`${s.player}-${i}`}>
                    <td className="l font-medium">{String(s.player)}</td>
                    <td className="l text-ink-3 text-[11.5px]">{String(s.position)}</td>
                    <td className="l">
                      <TeamMark
                        team={String(s.team)}
                        logo={teams[String(s.team)]?.logo}
                        size={16}
                        showAbbr={false}
                        href={`/teams/${s.team}`}
                      />
                    </td>
                    <td className="num text-ink-2">${num(Number(s.cap_hit), 1)}M</td>
                    <td className="num text-ink-2">{num(Number(s.par), 0)}</td>
                    <td className="num font-semibold text-pos">
                      {num(Number(s.par_per_million) * 10, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Cap space around the league" meta={`${season}, before any cuts`}>
            <div className="scroll-x max-h-[360px] scroll-y">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th className="l">Team</th>
                    <th>Committed</th>
                    <th>Space</th>
                    <th>Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((s) => (
                    <tr key={s.team}>
                      <td className="l">
                        <TeamMark
                          team={s.team}
                          logo={teams[s.team]?.logo}
                          href={`/tools/armchair-gm?team=${s.team}`}
                          name={teams[s.team]?.nick ?? s.team}
                        />
                      </td>
                      <td className="num text-ink-2">${num(s.committed, 1)}M</td>
                      <td
                        className="num font-semibold"
                        style={{ color: s.space < 0 ? "var(--neg)" : "var(--pos)" }}
                      >
                        {s.space < 0 ? "−" : ""}${num(Math.abs(s.space), 1)}M
                      </td>
                      <td className="num text-ink-3">{s.contracts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </Panel>
      </div>

      <Notes>
        <p>
          <b>Value</b> is last season&apos;s PAR — points above replacement — against this
          season&apos;s cap hit, so it rewards what a player did rather than what he will do.
          Rookies and free agent signings have no PAR, and offensive linemen carry none yet.
        </p>
        <ul>
          <li>
            Cuts are treated as pre-June-1. The post-June-1 designation, which splits dead money
            across two years, is not modelled.
          </li>
          <li>
            A restructure converts base salary above the minimum and spreads it over the years
            remaining, capped at five. Void years and option bonuses are not added.
          </li>
          <li>
            Only contracts running into {season} are counted, so a club whose deals mostly expire
            first shows space its real sheet does not have — tenders, options and existing dead
            money are not carried.
          </li>
          <li>
            The depth chart is the newest nflverse has published for {season}, which in August is a
            camp projection rather than a week 1 lineup. No depth entry means practice squad,
            injured reserve, or signed since.
          </li>
          <li>
            Injury designations appear only once the league publishes reports for {season}.
            Carrying last season&apos;s forward would show a January designation as current status.
          </li>
        </ul>
      </Notes>
    </>
  );
}
