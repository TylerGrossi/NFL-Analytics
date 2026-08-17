import Link from "next/link";
import { PickCurrency } from "@/components/PickCurrency";
import { Deck, Empty, Notes, Panel, PageHead, SectionRule, StatRow, StatTile, TeamMark } from "@/components/ui";
import { PickCurve } from "@/components/PickCurve";
import { SeasonNav } from "@/components/SeasonNav";
import {
  getDraftClass,
  getDraftCurve,
  getDraftOutliers,
  getDraftSeasons,
  getDraftTeams,
  getPickCurve,
  getPickMix,
  getTeamMap,
} from "@/lib/queries";
import { int, num, pct, signed } from "@/lib/format";

export const metadata = { title: "Draft" };
export const revalidate = 3600;

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const sp = await searchParams;
  const seasons = await getDraftSeasons();
  const newest = seasons[0] ?? 2025;
  const season = seasons.includes(Number(sp.season)) ? Number(sp.season) : newest;

  const [curve, teamRows, klass, steals, busts, teams, pickCurve, pickMix] = await Promise.all([
    getDraftCurve(),
    getDraftTeams(),
    getDraftClass(season),
    getDraftOutliers(true, 12),
    getDraftOutliers(false, 12),
    getTeamMap(),
    getPickCurve(),
    getPickMix("1-10"),
  ]);

  const at = (pick: number) => curve.find((c) => c.pick === pick);
  const top5 = curve.filter((c) => c.pick <= 5);
  const late1 = curve.filter((c) => c.pick >= 21 && c.pick <= 32);
  const mean = (rows: typeof curve) =>
    rows.length ? rows.reduce((a, b) => a + b.value, 0) / rows.length : 0;
  const topOverLate = mean(top5) / (mean(late1) || 1);

  return (
    <>
      <PageHead aside={`${int(curve.length)} slots · 1999–${newest}`}>Draft</PageHead>

      <Deck>What a pick is actually worth, across twenty-seven drafts.</Deck>

      <StatRow className="mb-5">
        <StatTile label="Pick 1" value={num(at(1)?.value, 1)} meta="expected career AV" />
        <StatTile label="Pick 32" value={num(at(32)?.value, 1)} meta="expected career AV" />
        <StatTile
          label="Top 5 vs late 1st"
          value={`${topOverLate.toFixed(2)}×`}
          meta="production ratio, not price"
        />
        <StatTile
          label="Pick 1 contributors"
          value={pct(at(1)?.contributor_rate, 0)}
          meta="reach 48 career games"
        />
        <StatTile
          label="Pick 200 contributors"
          value={pct(at(200)?.contributor_rate, 0)}
          meta="reach 48 career games"
        />
      </StatRow>

      <Panel
        title="What each slot returns"
        meta="dots are per-pick averages · line is the fitted curve"
        className="mb-4"
      >
        <div className="px-3 py-3">
          <PickCurve points={curve} />
        </div>
        <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-3 leading-relaxed">
          The curve decays far more gently than the trade market prices it. A top-five pick returns{" "}
          <b className="text-ink-2 num">{topOverLate.toFixed(2)}×</b> what a late first-rounder
          returns, while the standard trade chart values the top of the round several times higher —
          which is the surplus that makes trading down profitable, and has been the finding since
          Massey and Thaler put numbers on it in 2005. Classes from the last{" "}
          <span className="num">4</span> years are excluded: a 2024 pick has not had the chance to
          accumulate value, and counting him as a bust would bend the tail down.
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2 items-start mb-4">
        <Panel title="Who drafts well" meta="all 32 · value above what their slots were worth">
          <div className="scroll-x max-h-[900px] scroll-y">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="l">Team</th>
                  <th>Picks</th>
                  <th>AV</th>
                  <th>Exp</th>
                  <th>+/− per pick</th>
                  <th>Hit%</th>
                  <th>PB</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.map((r, i) => (
                  <tr key={r.team}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td className="l">
                      <TeamMark
                        team={r.team}
                        logo={teams[r.team]?.logo}
                        href={`/teams/${r.team}`}
                        name={teams[r.team]?.nick ?? r.team}
                      />
                    </td>
                    <td className="num text-ink-2">{int(r.picks)}</td>
                    <td className="num text-ink-2">{int(r.value)}</td>
                    <td className="num text-ink-3">{num(r.expected, 0)}</td>
                    <td
                      className={`num font-semibold ${
                        r.surplus_per_pick > 0 ? "text-pos" : "text-neg"
                      }`}
                    >
                      {signed(r.surplus_per_pick, 2)}
                    </td>
                    <td className="num text-ink-2">{pct(r.contributor_rate, 0)}</td>
                    <td className="num text-ink-2">{int(r.probowlers)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Outliers title="Biggest steals" rows={steals} teams={teams} good />
          <Outliers title="Biggest misses" rows={busts} teams={teams} good={false} />
        </div>
      </div>

      <SectionRule aside={`${klass.length} picks`}>{season} class</SectionRule>
      <SeasonNav seasons={seasons} active={season} href={(s) => `/draft?season=${s}`} />

      <div className="mb-4">
        <PickCurrency curve={pickCurve} mix={pickMix} />
      </div>

      <Panel title={`${season} draft`} meta="career value to date, against the slot">
        {klass.length === 0 ? (
          <Empty>No picks stored for this class.</Empty>
        ) : (
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Pick</th>
                  <th>Rd</th>
                  <th className="l">Player</th>
                  <th className="l">Pos</th>
                  <th className="l">Team</th>
                  <th className="l">College</th>
                  <th>G</th>
                  <th>St</th>
                  <th>PB</th>
                  <th>AV</th>
                  <th>Exp</th>
                  <th>+/−</th>
                  <th>WAR</th>
                  <th>40</th>
                </tr>
              </thead>
              <tbody>
                {klass.map((p) => (
                  <tr key={`${p.pick}-${p.name}`}>
                    <td className="num font-semibold">{p.pick}</td>
                    <td className="num text-ink-3">{p.round}</td>
                    <td className="l">
                      {p.player_id ? (
                        <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                          {p.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{p.name}</span>
                      )}
                    </td>
                    <td className="l text-ink-2">{p.position ?? "—"}</td>
                    <td className="l">
                      <TeamMark
                        team={p.team}
                        logo={teams[p.team]?.logo}
                        size={16}
                        href={`/teams/${p.team}`}
                        showAbbr={false}
                      />
                    </td>
                    <td className="l text-ink-3 text-[12px]">{p.college ?? "—"}</td>
                    <td className="num text-ink-2">{int(p.games)}</td>
                    <td className="num text-ink-2">{int(p.seasons_started)}</td>
                    <td className="num text-ink-2">{p.probowls || "—"}</td>
                    <td className="num font-semibold">{num(p.value, 0)}</td>
                    <td className="num text-ink-3">{num(p.pick_expected, 0)}</td>
                    <td
                      className={`num ${
                        (p.over_expected ?? 0) > 0 ? "text-pos" : "text-neg"
                      }`}
                    >
                      {p.over_expected === null ? "—" : signed(p.over_expected, 0)}
                    </td>
                    <td className="num text-ink-2">
                      {p.career_war === null ? "—" : num(p.career_war, 1)}
                    </td>
                    <td className="num text-ink-3">{p.forty === null ? "—" : num(p.forty, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Notes>
        <p>
          <b>Why Approximate Value, not WAR.</b> AV is cruder than this site&apos;s WAR but exists
          for every position in every year, which is what a question spanning twenty-seven drafts
          needs. Defensive WAR needs charting that begins in 2018 and line WAR needs snap counts
          from 2012, so a defender drafted in 2004 has none — he would silently score as a bust.
          Career WAR is joined on anyway for the modern classes.
        </p>
        <p>
          <b>Two choices carry the result.</b> A pick who never played counts as a zero rather than
          dropping out of the sample; removing them is what makes late rounds look productive. And
          the last four classes are excluded, because a recent pick has not had the chance to
          accumulate value and counting him as a bust would bend the tail down.
        </p>
        <p>
          The curve is a light rolling mean forced monotone by isotonic regression, weighted by how
          many players stand behind each pick. Combine testing is joined where the player attended;
          a blank forty means he did not run one. Franchises carry their history through
          relocation, so Oakland&apos;s picks count for Las Vegas.
        </p>
      </Notes>
    </>
  );
}

function Outliers({
  title,
  rows,
  teams,
  good,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof getDraftOutliers>>;
  teams: Awaited<ReturnType<typeof getTeamMap>>;
  good: boolean;
}) {
  return (
    <Panel title={title} meta="career AV against the slot's expectation">
      <div className="scroll-x">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="l">Player</th>
              <th className="l">Tm</th>
              <th>Yr</th>
              <th>Pick</th>
              <th>AV</th>
              <th>Exp</th>
              <th>+/−</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={`${p.season}-${p.pick}`}>
                <td className="l">
                  {p.player_id ? (
                    <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{p.name}</span>
                  )}
                </td>
                <td className="l">
                  <TeamMark
                    team={p.team}
                    logo={teams[p.team]?.logo}
                    size={16}
                    showAbbr={false}
                  />
                </td>
                <td className="num text-ink-3">{p.season}</td>
                <td className="num text-ink-2">{p.pick}</td>
                <td className="num">{num(p.value, 0)}</td>
                <td className="num text-ink-3">{num(p.pick_expected, 0)}</td>
                <td className={`num font-semibold ${good ? "text-pos" : "text-neg"}`}>
                  {signed(p.over_expected, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
