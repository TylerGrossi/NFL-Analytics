"use client";

import { useRouter } from "next/navigation";

/**
 * The club picker's control half.
 *
 * Thirty-two abbreviations laid out as chips was a wall of controls the width
 * of the page, and a reader looking for one club had to scan a row of codes to
 * find it. A select holds all of them at the cost of one control, and it can
 * carry the full club name rather than the three-letter code.
 *
 * Client half only: the page resolves each club to a real URL first, because a
 * callers' `href` function cannot cross the server/client boundary.
 */
export function TeamSelect({
  options,
  active,
  label = "Team",
}: {
  options: { team: string; name: string; href: string }[];
  active: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <div className="flex gap-2 items-center">
      <label htmlFor="team-select" className="label shrink-0">
        {label}
      </label>
      <select
        id="team-select"
        value={active}
        onChange={(event) => {
          const next = options.find((o) => o.team === event.target.value);
          if (next) router.push(next.href);
        }}
        /* Fixed width for the same reason the season picker has one: globals.css
           sets `.flex > * { min-width: 0 }`, which beats Tailwind's min-w-*, so
           a select left to size itself collapses inside a flex row. */
        className="w-[176px] h-[30px] shrink-0 px-2 text-[12px] rounded-[3px]
                   border border-rule bg-panel text-ink cursor-pointer
                   hover:border-rule-strong transition-colors"
      >
        {options.map((o) => (
          <option key={o.team} value={o.team}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
