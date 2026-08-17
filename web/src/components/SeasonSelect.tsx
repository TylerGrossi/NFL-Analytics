"use client";

import { useRouter } from "next/navigation";

/**
 * The season picker's control half.
 *
 * `SeasonNav` stays a server component because its callers pass `href` as a
 * function, and a function cannot cross the server/client boundary. It resolves
 * every season to a real URL first and hands this component the resolved list,
 * which is plain data and serialises fine.
 */
export function SeasonSelect({
  options,
  active,
  label,
}: {
  options: { season: number; href: string }[];
  active: number;
  label: string;
}) {
  const router = useRouter();

  return (
    <div className="flex gap-2 items-center mb-4">
      <label htmlFor="season-select" className="label shrink-0">
        {label}
      </label>
      <select
        id="season-select"
        value={active}
        onChange={(event) => {
          const next = options.find((o) => String(o.season) === event.target.value);
          if (next) router.push(next.href);
        }}
        /* Fixed width on purpose: globals.css sets `.flex > * { min-width: 0 }`,
           which beats Tailwind's min-w-* utilities, so a select left to size
           itself collapses to nothing inside a flex row. */
        className="num w-[88px] shrink-0 px-2 py-1 text-[12px] rounded-[3px]
                   border border-rule bg-panel text-ink cursor-pointer
                   hover:border-rule-strong transition-colors"
      >
        {options.map((o) => (
          <option key={o.season} value={o.season}>
            {o.season}
          </option>
        ))}
      </select>
    </div>
  );
}
