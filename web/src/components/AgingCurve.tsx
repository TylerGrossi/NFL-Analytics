import { ChartExport } from "@/components/ChartExport";
import { LineChart } from "@/components/LineChart";
import { Panel } from "@/components/ui";
import type { AgingRow } from "@/lib/queries";
import { signed } from "@/lib/format";

/**
 * What this player's position does with age, and where he sits on it.
 *
 * Fit by the **delta method** — the same player compared in consecutive
 * seasons. The obvious construction, mean EPA by age, is dominated by
 * survivorship: weak players leave the league, so the average at 32 is an
 * average over survivors and the curve "peaks" wherever attrition is harshest.
 * Built that way it put the running back peak at 21, which is nonsense.
 *
 * The curve is zeroed at 24 because that is roughly where a second contract is
 * negotiated from, so the numbers read as "expected points better or worse than
 * this player's own age-24 baseline" rather than as a level.
 *
 * EPA is charged to whoever touched the ball, so only quarterbacks, backs,
 * receivers and tight ends have a curve. Linemen and defenders get none rather
 * than an offensive curve wearing their label.
 */
export function AgingCurve({
  rows,
  age,
  posGroup,
  fellBack,
}: {
  rows: AgingRow[];
  age: number | null;
  posGroup: string | null;
  fellBack: boolean;
}) {
  if (rows.length < 5) return null;

  const here = age === null ? null : rows.find((r) => r.age === age) ?? null;
  const ahead = age === null
    ? []
    : [1, 2, 3]
        .map((k) => ({ k, row: rows.find((r) => r.age === age + k) ?? null }))
        .filter((x) => x.row !== null);

  const peak = rows.reduce((a, b) => (b.rel_epa > a.rel_epa ? b : a), rows[0]);

  return (
    <Panel
      title="Aging curve"
    >
      <div className="px-3 pt-2 pb-1">
        <ChartExport
          filename={`aging-${(posGroup ?? "all").toLowerCase()}`}
          caption={`${fellBack ? "All positions" : posGroup} aging curve · delta method`}
        >
        <LineChart
          labels={rows.map((r) => String(r.age))}
          height={150}
          width={1180}
          format={(v) => v.toFixed(1)}
          series={[
            {
              name: fellBack ? "All positions" : `${posGroup} aging`,
              color: "var(--c1)",
              values: rows.map((r) => r.rel_epa),
              fill: true,
            },
          ]}
        />
        </ChartExport>
      </div>

      <div className="px-4 py-2.5 border-t border-rule grid gap-3 grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
        <div>
          <div className="label">Peaks at</div>
          <div className="num text-[17px] font-semibold mt-0.5">{peak.age}</div>
        </div>
        {here && (
          <div>
            <div className="label">At {age}</div>
            <div className="num text-[17px] font-semibold mt-0.5">{signed(here.rel_epa, 1)}</div>
          </div>
        )}
        {ahead.map(({ k, row }) => (
          <div key={k}>
            <div className="label">
              Age {age! + k}
            </div>
            <div
              className="num text-[17px] font-semibold mt-0.5"
              style={{
                color:
                  here && row!.rel_epa < here.rel_epa
                    ? "var(--neg)"
                    : here && row!.rel_epa > here.rel_epa
                      ? "var(--pos)"
                      : undefined,
              }}
            >
              {signed(row!.rel_epa - (here?.rel_epa ?? 0), 1)}
            </div>
            <div className="text-[11px] text-ink-3">from today</div>
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-rule text-[11.5px] text-ink-3 leading-relaxed">
        Measured by comparing the same player in consecutive seasons, which controls for who he
        is — a plain average by age mostly measures who is still in the league.{" "}
        {fellBack
          ? "This position has too few paired seasons for its own curve, so the all-position curve is shown."
          : "Read it as a positional tendency, not a forecast for one player."}{" "}
        The scale is expected points over a season, so it is much wider at quarterback than
        anywhere else.
      </div>
    </Panel>
  );
}
