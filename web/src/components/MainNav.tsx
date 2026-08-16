"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, type NavGroup } from "@/lib/site";

/**
 * Primary navigation.
 *
 * Grouped rather than flat: five section names, each opening onto the handful
 * of pages beneath it. The menu is CSS-driven — a group opens on hover and on
 * keyboard focus within it — so there is no open/closed state to manage and it
 * works before JavaScript arrives. Only the current-section marker needs the
 * client, which is why this file is the one component that takes it.
 */
export function MainNav() {
  const pathname = usePathname();

  const inGroup = (group: NavGroup) =>
    group.items.some((i) =>
      i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`)
    );

  return (
    <nav className="flex items-stretch h-full" aria-label="Primary">
      {NAV.map((group) => {
        const active = inGroup(group);
        return (
          <div key={group.label} className="relative group/nav flex items-stretch shrink-0">
            <Link
              href={group.href}
              aria-current={active ? "page" : undefined}
              className={`text-[13.5px] font-medium px-3.5 flex items-center gap-1.5 whitespace-nowrap
                no-underline border-b-2 transition-colors
                ${
                  active
                    ? "text-white border-white"
                    : "text-white/60 hover:text-white border-transparent"
                }`}
            >
              {group.label}
              <svg
                width="9"
                height="9"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className="opacity-45 mt-px"
              >
                <path d="M1 3.2 5 7l4-3.8" stroke="currentColor" strokeWidth="1.4" fill="none" />
              </svg>
            </Link>

            <div
              className="absolute left-0 top-full z-50 pt-0 w-[262px] invisible opacity-0
                         group-hover/nav:visible group-hover/nav:opacity-100
                         group-focus-within/nav:visible group-focus-within/nav:opacity-100
                         transition-opacity duration-100"
            >
              <div className="bg-panel border border-rule rounded-[4px] shadow-[0_8px_28px_rgba(12,23,37,0.16)] overflow-hidden">
                {group.items.map((item) => {
                  const here =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block px-3.5 py-2.5 no-underline border-b border-rule last:border-0
                        transition-colors ${here ? "bg-accent-wash" : "hover:bg-panel-2"}`}
                    >
                      <span
                        className={`block text-[13px] font-medium ${
                          here ? "text-accent" : "text-ink"
                        }`}
                      >
                        {item.label}
                      </span>
                      {item.blurb && (
                        <span className="block text-[11.5px] text-ink-3 mt-0.5 leading-snug">
                          {item.blurb}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Flat list for narrow screens, where a hover menu has nothing to hover. */
export function MobileNav() {
  const pathname = usePathname();
  const items = NAV.flatMap((g) => g.items);
  return (
    <nav className="flex items-stretch h-full" aria-label="Primary">
      {items.map((item) => {
        const here =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={here ? "page" : undefined}
            className={`text-[13px] font-medium px-3 flex items-center whitespace-nowrap shrink-0
              border-b-2 no-underline transition-colors
              ${here ? "text-white border-white" : "text-white/60 border-transparent"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
