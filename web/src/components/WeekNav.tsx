"use client";

import { useRouter } from "next/navigation";

/**
 * Season and week pickers for the week page.
 *
 * The page used to move only through prev/next links, so reaching week 3 of
 * 2021 from the Super Bowl meant twenty clicks. Two selects reach any week in
 * the store in one, and the week list carries round names rather than the
 * numbers 19 to 22, which mean nothing to a reader.
 */
export function WeekNav({
  seasons,
  weeks,
  season,
  week,
}: {
  seasons: number[];
  weeks: { week: number; label: string }[];
  season: number;
  week: number;
}) {
  const router = useRouter();
  const control =
    "h-[30px] shrink-0 px-2 text-[12px] rounded-[3px] border border-rule bg-panel " +
    "text-ink cursor-pointer hover:border-rule-strong transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex gap-2 items-center">
        <label htmlFor="week-season" className="label shrink-0">
          Season
        </label>
        <select
          id="week-season"
          value={season}
          className={`num w-[88px] ${control}`}
          onChange={(e) => router.push(`/week/${e.target.value}/1`)}
        >
          {seasons.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 items-center">
        <label htmlFor="week-week" className="label shrink-0">
          Week
        </label>
        <select
          id="week-week"
          value={week}
          className={`w-[180px] ${control}`}
          onChange={(e) => router.push(`/week/${season}/${e.target.value}`)}
        >
          {weeks.map((w) => (
            <option key={w.week} value={w.week}>
              {w.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
