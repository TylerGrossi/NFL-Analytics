import { Empty, Panel } from "@/components/ui";
import type { FormationSplit } from "@/lib/queries";
import { num, pct, signed } from "@/lib/format";

/** Readable labels for the raw feed values. */
const FORMATION_LABELS: Record<string, string> = {
  SHOTGUN: "Shotgun",
  "UNDER CENTER": "Under center",
  PISTOL: "Pistol",
  SINGLEBACK: "Singleback",
  EMPTY: "Empty",
  I_FORM: "I-formation",
  JUMBO: "Jumbo",
  WILDCAT: "Wildcat",
};

const COVERAGE_LABELS: Record<string, string> = {
  COVER_0: "Cover 0",
  COVER_1: "Cover 1",
  COVER_2: "Cover 2",
  COVER_3: "Cover 3",
  COVER_4: "Cover 4",
  COVER_6: "Cover 6",
  COVER_9: "Cover 9",
  "2_MAN": "2-Man",
  COMBO: "Combo",
  BLOWN: "Blown",
  MAN_COVERAGE: "Man",
  ZONE_COVERAGE: "Zone",
};

function label(dimension: string, value: string) {
  if (dimension === "formation") return FORMATION_LABELS[value] ?? value;
  if (dimension === "personnel") return `${value} personnel`;
  return COVERAGE_LABELS[value] ?? value;
}

/** Usage rate as a bar, with the EPA that came with it. */
function UsageRows({ rows, dimension }: { rows: FormationSplit[]; dimension: string }) {
  if (rows.length === 0) return <Empty>No charted plays for this season.</Empty>;
  const max = Math.max(...rows.map((r) => r.rate));

  return (
    <div className="px-4 py-2">
      {rows.map((r) => (
        <div key={r.value} className="py-[7px] border-b border-rule last:border-0">
          <div className="flex justify-between items-baseline text-[12.5px] mb-1.5">
            <span className="text-ink-2">{label(dimension, r.value)}</span>
            <span className="flex items-center gap-3">
              <span className="num text-ink-3 text-[11.5px]">{r.plays.toLocaleString("en-US")} plays</span>
              <b className="num w-[46px] text-right">{pct(r.rate, 1)}</b>
              <b
                className="num w-[52px] text-right"
                style={{ color: (r.epa ?? 0) >= 0 ? "var(--pos)" : "var(--neg)" }}
              >
                {signed(r.epa)}
              </b>
            </span>
          </div>
          <div className="h-[7px] rounded-[2px] bg-panel-3 overflow-hidden">
            <div
              className="h-full rounded-[2px]"
              style={{ width: `${(r.rate / max) * 100}%`, background: "var(--c1)" }}
            />
          </div>
        </div>
      ))}
      <div className="text-[11px] text-ink-3 pt-2">
        Bar is share of charted plays; the right-hand figure is EPA per play from that look.
      </div>
    </div>
  );
}

export function FormationPanels({
  splits,
  participation,
}: {
  splits: FormationSplit[];
  participation: Record<string, number | string | null> | undefined;
}) {
  const by = (dimension: string, side: string) =>
    splits
      .filter((s) => s.dimension === dimension && s.side === side)
      .sort((a, b) => b.plays - a.plays);

  const formations = by("formation", "offense");
  const personnel = by("personnel", "offense").slice(0, 7);
  const manZone = by("man_zone", "defense");
  const coverage = by("coverage", "defense").slice(0, 7);

  const hasAny = formations.length || personnel.length || manZone.length;
  if (!hasAny && !participation) return null;

  return (
    <>
      {participation && (
        <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))] mb-4">
          <Tile
            label="Pressure rate allowed"
            value={pct(participation.pressure_rate_allowed as number, 1)}
          />
          <Tile
            label="EPA when pressured"
            value={signed(participation.epa_pressured as number)}
          />
          <Tile
            label="Pressure rate generated"
            value={pct(participation.pressure_rate as number, 1)}
          />
          <Tile
            label="Blitz rate"
            value={pct(participation.blitz_rate as number, 1)}
          />
          <Tile
            label="Man coverage"
            value={pct(participation.man_rate as number, 1)}
          />
          <Tile
            label="Box faced"
            value={num(participation.box_faced as number, 2)}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <Panel title="Offensive formation">
          <UsageRows rows={formations} dimension="formation" />
        </Panel>
        <Panel title="Personnel grouping">
          <UsageRows rows={personnel} dimension="personnel" />
        </Panel>
        <Panel title="Coverage shell">
          <UsageRows rows={coverage} dimension="coverage" />
        </Panel>
        <Panel title="Man vs zone">
          <UsageRows rows={manZone} dimension="man_zone" />
        </Panel>
      </div>
    </>
  );
}


function Tile({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="panel px-3.5 py-3">
      <div className="label">{label}</div>
      <div className="num text-[22px] leading-tight font-semibold mt-1">{value}</div>
      {meta && <div className="text-[11px] text-ink-2 mt-0.5">{meta}</div>}
    </div>
  );
}
