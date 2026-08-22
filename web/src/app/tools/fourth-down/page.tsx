import { FourthDownCalculator } from "@/components/FourthDownCalculator";
import { Panel, PageHead, SectionRule, TeamMark, StatTile } from "@/components/ui";
import { SeasonNav } from "@/components/SeasonNav";
import {
  getBuiltSeasons,
  getFourthDownTeams,
  getManifest,
  getTeamMap,
  getWorstFourthDowns,
} from "@/lib/queries";
import { fourthCall, int, num, pct } from "@/lib/format";

export const metadata = { title: "Fourth down" };
export const revalidate = 300;

export default async function FourthDownPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const manifest = await getManifest();
  const seasons = await getBuiltSeasons();
  const season = Number(sp.season ?? manifest.stats_season);
  const [teams, coaches, worst] = await Promise.all([
    getTeamMap(),
    getFourthDownTeams(season),
    getWorstFourthDowns(season, 10),
  ]);

  const league = coaches.reduce(
    (acc, t) => {
      acc.situations += t.situations;
      acc.went += t.went;
      acc.go_optimal += t.go_optimal;
      acc.went_when_optimal += t.went_when_optimal;
      acc.wp_lost += t.wp_lost;
      return acc;
    },
    { situations: 0, went: 0, go_optimal: 0, went_when_optimal: 0, wp_lost: 0 }
  );

  const byAggression = [...coaches].sort(
    (a, b) => (b.go_rate_when_optimal ?? 0) - (a.go_rate_when_optimal ?? 0)
  );

  return (
    <>
      <PageHead>Fourth down</PageHead>

      <FourthDownCalculator />

      <SectionRule>
        How coaches actually decided
      </SectionRule>

      <SeasonNav
        seasons={seasons}
        active={season}
        href={(s) => `/tools/fourth-down?season=${s}`}
      />

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(160px,1fr))] mb-4">
        <StatTile
          label="Decisions"
          value={int(league.situations)}
        />
        <StatTile
          label="Went for it"
          value={pct(league.went / league.situations, 0)}
        />
        <StatTile
          label="Model says go"
          value={pct(league.go_optimal / league.situations, 0)}
        />
        <StatTile
          label="Took the advice"
          value={pct(league.went_when_optimal / league.go_optimal, 0)}
          tone="bad"
        />
        <StatTile
          label="Win prob. surrendered"
          value={num(league.wp_lost / 32, 1)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr] items-start">
        <Panel title="Aggressiveness">
          <div className="scroll-x max-h-[452px] scroll-y">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="l">Coach</th>
                  <th>Spots</th>
                  <th>Went</th>
                  <th>Go rate</th>
                  <th>When optimal</th>
                  <th>WP lost</th>
                </tr>
              </thead>
              <tbody>
                {byAggression.map((t) => (
                  <tr key={t.team}>
                    <td>
                      <TeamMark
                        team={t.team}
                        logo={teams[t.team]?.logo}
                        href={`/teams/${t.team}`}
                        name={teams[t.team]?.nick ?? t.team}
                      />
                    </td>
                    <td className="l text-ink-2 text-[12px]">{t.coach ?? "—"}</td>
                    <td className="num text-ink-2">{int(t.situations)}</td>
                    <td className="num text-ink-2">{int(t.went)}</td>
                    <td className="num text-ink-2">{pct(t.go_rate, 0)}</td>
                    <td className="num font-semibold">{pct(t.go_rate_when_optimal, 0)}</td>
                    <td className="num text-neg">{num(t.wp_lost, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Costliest decisions">
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Wk</th>
                    <th>Team</th>
                    <th className="l">Situation</th>
                    <th className="l">Chose</th>
                    <th className="l">Model</th>
                    <th>WP lost</th>
                  </tr>
                </thead>
                <tbody>
                  {worst.map((w, i) => (
                    <tr key={`${w.game_id}-${w.play_id}-${i}`}>
                      <td className="num text-ink-3">{String(w.week)}</td>
                      <td>
                        <TeamMark
                          team={String(w.posteam)}
                          logo={teams[String(w.posteam)]?.logo}
                          href={`/teams/${w.posteam}`}
                          size={17}
                          showAbbr={false}
                        />
                      </td>
                      <td className="l text-[12px] text-ink-2">
                        4th &amp; {String(w.ydstogo)} ·{" "}
                        {Number(w.yardline_100) > 50
                          ? `Own ${100 - Number(w.yardline_100)}`
                          : `Opp ${w.yardline_100}`}
                      </td>
                      <td className="l text-[12px] num text-ink-2">{fourthCall(w.choice as string)}</td>
                      <td className="l text-[12px] num font-semibold">{fourthCall(w.best as string)}</td>
                      <td className="num text-neg font-semibold">{num(Number(w.wp_lost), 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

        </div>
      </div>

    </>
  );
}
