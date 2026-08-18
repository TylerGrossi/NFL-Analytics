import { ChartExport } from "@/components/ChartExport";
import { LineChart } from "@/components/LineChart";
import { Empty, Panel } from "@/components/ui";
import type { PickMixRow, PickValueRow } from "@/lib/queries";
import { num } from "@/lib/format";

/**
 * The two currencies, and why they disagree.
 *
 * The pick value curve on this page is denominated in Approximate Value,
 * because AV exists for every position in every year and career WAR does not.
 * That choice is already defended here — but it has a consequence nobody
 * states: AV and WAR price the top of the draft completely differently, and
 * the whole of the gap is quarterbacks.
 */
export function PickCurrency({
  curve,
  mix,
}: {
  curve: PickValueRow[];
  mix: PickMixRow[];
}) {
  if (curve.length === 0) return null;

  const shown = curve.filter((c) => c.pick <= 64);
  const band = (from: number, to: number, key: "war" | "av") => {
    const rows = curve.filter((c) => c.pick >= from && c.pick <= to);
    return rows.length ? rows.reduce((a, b) => a + b[key], 0) / rows.length : 0;
  };
  const warRatio = band(1, 5, "war") / (band(25, 32, "war") || 1);
  const avRatio = band(1, 5, "av") / (band(25, 32, "av") || 1);

  const qb = mix.find((m) => m.position === "QB");
  const rest = mix.filter((m) => m.position !== "QB");
  const restPicks = rest.reduce((a, b) => a + b.n, 0);
  const restWar = restPicks
    ? rest.reduce((a, b) => a + b.war * b.n, 0) / restPicks
    : 0;
  const peak = Math.max(...mix.map((m) => Math.max(m.war, 0.01)), 0.01);

  return (
    <Panel
      title="Two currencies, two answers"
    >
      <div className="px-4 pt-3">
        <ChartExport
          filename="pick-value-two-currencies"
          caption="Expected career return by pick · AV vs WAR"
        >
        <LineChart
          labels={shown.map((c) => String(c.pick))}
          height={190}
          width={620}
          zeroLine={false}
          format={(v) => v.toFixed(0)}
          series={[
            {
              name: "Approximate Value",
              color: "var(--c2)",
              values: shown.map((c) => c.av_relative * 100),
            },
            {
              name: "WAR",
              color: "var(--c1)",
              values: shown.map((c) => c.war_relative * 100),
            },
          ]}
        />
        </ChartExport>
      </div>

      <div className="px-4 py-3 grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border-t border-rule">
        <div>
          <div className="label">Top-5 vs late first</div>
          <div className="num text-[22px] font-semibold mt-0.5">{num(avRatio, 1)}×</div>
          <div className="text-[11px] text-ink-3">in Approximate Value</div>
        </div>
        <div>
          <div className="label">Top-5 vs late first</div>
          <div
            className="num text-[22px] font-semibold mt-0.5"
            style={{ color: "var(--accent)" }}
          >
            {num(warRatio, 1)}×
          </div>
          <div className="text-[11px] text-ink-3">in WAR</div>
        </div>
        {qb && (
          <div>
            <div className="label">Top-10 quarterback</div>
            <div className="num text-[22px] font-semibold mt-0.5">{num(qb.war, 1)}</div>
            <div className="text-[11px] text-ink-3">career WAR · {qb.n} picks</div>
          </div>
        )}
        {rest.length > 0 && (
          <div>
            <div className="label">Top-10, everyone else</div>
            <div className="num text-[22px] font-semibold mt-0.5">{num(restWar, 1)}</div>
            <div className="text-[11px] text-ink-3">career WAR · {restPicks} picks</div>
          </div>
        )}
      </div>

      {mix.length > 0 ? (
        <div className="scroll-x border-t border-rule">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="l">Top-10 picks spent on</th>
                <th>Picks</th>
                <th>Career WAR</th>
                <th>Career AV</th>
                <th className="l" style={{ width: 150 }} aria-label="Career WAR returned" />
              </tr>
            </thead>
            <tbody>
              {mix.map((m) => (
                <tr key={m.position}>
                  <td className="l font-medium">{m.position}</td>
                  <td className="num text-ink-3">{m.n}</td>
                  <td className="num font-semibold">{num(m.war, 2)}</td>
                  <td className="num text-ink-2">{num(m.av, 0)}</td>
                  <td className="l">
                    <span className="relative block h-[11px] bg-panel-2 rounded-[2px]">
                      <span
                        className="absolute inset-y-0 left-0 rounded-[1px]"
                        style={{
                          width: `${(Math.max(0, m.war) / peak) * 100}%`,
                          background:
                            m.position === "QB" ? "var(--c1)" : "var(--rule-strong)",
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No position breakdown built.</Empty>
      )}

      <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-2">
        Both curves come from the same picks, 2012–2021. AV rates a top-ten quarterback and a
        top-ten interior lineman as near-equals; WAR has the quarterback ahead by an order of
        magnitude, because AV deliberately compresses the gap between positions and WAR does
        not. A top pick&apos;s value in wins is therefore mostly an{" "}
        <em>option on a quarterback</em> — which is worth knowing before reading the AV curve
        above as though every slot were fungible.
      </div>
    </Panel>
  );
}
