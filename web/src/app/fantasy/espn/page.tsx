import Link from "next/link";
import { Deck, DivergingBar, Empty, Panel, SectionRule, StatTile } from "@/components/ui";
import { getEspnValue, type EspnValueRow } from "@/lib/queries";
import { num } from "@/lib/format";

export const metadata = { title: "ESPN league value" };
export const revalidate = 900;

const MIN_OWNED = 20;

export default async function EspnValuePage() {
  const rows = await getEspnValue(MIN_OWNED);

  if (rows.length === 0) {
    return (
      <>
        <SectionRule>ESPN league value</SectionRule>
        <Empty>ESPN draft positions have not been fetched yet.</Empty>
      </>
    );
  }

  const bargains = rows.filter((r) => r.gap > 0).slice(0, 25);
  const reaches = [...rows].reverse().filter((r) => r.gap < 0).slice(0, 25);
  const season = rows[0]?.season;
  const biggest = bargains[0];

  // How closely ESPN's board tracks the consensus overall.
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const byPos = ["QB", "RB", "WR", "TE"].map((p) => {
    const pool = rows.filter((r) => r.position === p);
    return { pos: p, n: pool.length, mean: mean(pool.map((r) => r.gap)) };
  });

  return (
    <>
      <SectionRule
        aside={
          <Link href="/fantasy/draft" className="text-accent">
            Draft board
          </Link>
        }
      >
        ESPN league value · {season}
      </SectionRule>

      <Deck>
        ESPN&apos;s board is not one more opinion — it is a model of the room you are drafting
        against.
      </Deck>

      <div className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(190px,1fr))] mb-4">
        <StatTile
          label="Biggest ESPN bargain"
          value={biggest?.name ?? "—"}
          meta={biggest ? `${biggest.gap.toFixed(0)} picks later than consensus` : undefined}
        />
        <StatTile label="Players compared" value={String(rows.length)} meta={`≥${MIN_OWNED}% rostered`} />
        {byPos.map((b) => (
          <StatTile
            key={b.pos}
            label={`${b.pos} drift`}
            value={`${b.mean > 0 ? "+" : ""}${b.mean.toFixed(1)}`}
            meta={`mean gap · ${b.n} players`}
            tone={b.mean > 3 ? "good" : b.mean < -3 ? "bad" : "neutral"}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <ValueTable
          title="Best value in ESPN leagues"
          meta="fall later than the consensus rates them"
          rows={bargains}
          good
        />
        <ValueTable
          title="Reaches in ESPN leagues"
          meta="go earlier than the consensus rates them"
          rows={reaches}
          good={false}
        />
      </div>

      <div className="text-[11.5px] text-ink-3 mt-4 max-w-[92ch] leading-relaxed">
        <b className="text-ink-2">What the numbers are.</b> <span className="num">ESPN</span> is the
        average draft position observed across ESPN leagues — what drafters do, not what the site
        recommends, and the better guide of the two where they disagree.{" "}
        <span className="num">Cons</span> is the FantasyPros expert consensus rank for the same
        format, full PPR redraft. The gap is ESPN minus consensus, so a positive number means the
        player lasts longer in an ESPN room than his consensus rank says he should.
        <br />
        <br />
        <b className="text-ink-2">Two cautions.</b> ESPN publishes an average draft position for
        every player, including ones nobody drafts, by parking them all on a single sentinel value
        just past the last real pick — 739 of 1,071 sat there this year with a median ownership of
        0.04%. Those are detected and dropped rather than compared, because against a consensus rank
        they manufacture enormous fake disagreements that would otherwise fill the right-hand table.
        Only players rostered in at least {MIN_OWNED}% of leagues are shown, which keeps the
        comparison to players actually being drafted. And a gap is not automatically an edge: ESPN
        sometimes ranks a player low because he is hurt or has lost his job, and is right to.
      </div>
    </>
  );
}

function ValueTable({
  title,
  meta,
  rows,
  good,
}: {
  title: string;
  meta: string;
  rows: EspnValueRow[];
  good: boolean;
}) {
  return (
    <Panel title={title} meta={meta}>
      {rows.length === 0 ? (
        <Empty>Nothing clears the threshold.</Empty>
      ) : (
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th>ESPN</th>
                <th>Cons</th>
                <th>Gap</th>
                <th className="w-[80px]">&nbsp;</th>
                <th>Own</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player_id}>
                  <td className="l">
                    <Link href={`/players/${r.player_id}`} className="link-cell font-medium">
                      {r.name}
                    </Link>
                  </td>
                  <td className="l text-ink-2">
                    {r.position}
                    {r.depth_rank && r.depth_rank > 1 && (
                      <span className="text-ink-3 num ml-1 text-[10.5px]">{r.depth_rank}</span>
                    )}
                  </td>
                  <td className="num text-ink-2">{num(r.espn_adp, 1)}</td>
                  <td className="num text-ink-3">{num(r.ecr_redraft, 1)}</td>
                  <td className={`num font-semibold ${good ? "text-pos" : "text-neg"}`}>
                    {r.gap > 0 ? `+${r.gap.toFixed(0)}` : r.gap.toFixed(0)}
                  </td>
                  <td>
                    <DivergingBar value={r.gap} max={70} />
                  </td>
                  <td className="num text-ink-3">
                    {r.espn_pct_owned === null ? "—" : `${r.espn_pct_owned.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
