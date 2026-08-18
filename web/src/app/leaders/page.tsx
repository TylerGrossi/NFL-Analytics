import Link from "next/link";
import { Panel, SectionRule, TeamMark } from "@/components/ui";
import {
  LEADER_CATEGORIES,
  getLeaders,
  getManifest,
  getTeamMap,
} from "@/lib/queries";
import { int, num, pct, pts, signed } from "@/lib/format";

export const metadata = { title: "Leaders" };
export const revalidate = 300;

function cell(value: unknown, digits?: number, key?: string) {
  const v = value as number | null;
  if (v === null || v === undefined) return "—";
  if (key === "cpoe") return pts(v);
  if (digits === undefined) return int(v);
  // Rates stored 0–1 render as percentages; everything else keeps its own scale.
  if (key && /(_rate|success|_pct)$/.test(key) && Math.abs(v) <= 1) return pct(v, 0);
  if (key && /^(epa|total)/.test(key)) return signed(v, digits);
  if (key && /epa/.test(key)) return signed(v, digits);
  return num(v, digits);
}

export default async function LeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const manifest = await getManifest();
  const season = manifest.stats_season;
  const active = LEADER_CATEGORIES.find((c) => c.key === cat) ?? LEADER_CATEGORIES[0];

  const [rows, teams] = await Promise.all([getLeaders(active.key, season, 50), getTeamMap(season)]);

  return (
    <>
      <SectionRule>Leaders</SectionRule>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {LEADER_CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={`/leaders?cat=${c.key}`}
            className={`px-3 py-1.5 rounded-[3px] border whitespace-nowrap shrink-0 text-[12px] no-underline transition-colors ${
              c.key === active.key
                ? "bg-navy border-navy text-white"
                : "bg-panel border-rule text-ink-2 hover:border-rule-strong"
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      <Panel title={active.label}>
        <div className="scroll-x">
          <table className="grid-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="l">Player</th>
                <th className="l">Pos</th>
                <th className="l">Team</th>
                <th>G</th>
                {active.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={String(p.player_id)}>
                  <td className="num text-ink-3">{i + 1}</td>
                  <td className="l">
                    <Link href={`/players/${p.player_id}`} className="link-cell font-medium">
                      {String(p.player_display_name)}
                    </Link>
                  </td>
                  <td className="l text-ink-3 text-[11.5px]">{String(p.position)}</td>
                  <td className="l">
                    <TeamMark
                      team={String(p.recent_team)}
                      logo={teams[String(p.recent_team)]?.logo}
                      href={`/teams/${p.recent_team}`}
                      size={17}
                      showAbbr={false}
                    />
                  </td>
                  <td className="num text-ink-2">{int(p.games as number)}</td>
                  {active.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`num ${c.key === active.metric ? "font-semibold" : "text-ink-2"}`}
                    >
                      {cell(p[c.key], c.digits, c.key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
