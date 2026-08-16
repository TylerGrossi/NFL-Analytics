"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Hit = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  headshot: string | null;
  last_season: number | null;
};

export function PlayerSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Whether results show is derived from the query, so a short query hides the
  // last result set without an extra state write.
  const tooShort = q.trim().length < 2;
  const visible = tooShort ? [] : hits;

  useEffect(() => {
    if (q.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (res.ok) setHits(await res.json());
      } catch {
        // aborted or offline — leave the last result set alone
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      const typing =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(e.target.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        input.current?.blur();
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={box} className="relative hidden sm:block">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>

      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search players"
        aria-label="Search players"
        className="w-[196px] focus:w-[248px] bg-white/8 border border-white/15 rounded-[3px]
          pl-8 pr-7 py-[5px] text-[12.5px] text-white placeholder:text-white/40
          hover:bg-white/12 focus:bg-white/14 focus:border-white/30 transition-all outline-none"
      />

      {q.length === 0 && (
        <kbd
          className="absolute right-2 top-1/2 -translate-y-1/2 num text-[10px] text-white/35
            border border-white/20 rounded-[2px] px-1 leading-[14px] pointer-events-none"
        >
          /
        </kbd>
      )}

      {open && visible.length > 0 && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-[310px] bg-panel border border-rule rounded-[3px] shadow-[0_14px_32px_-14px_rgba(12,23,37,0.55)] overflow-hidden z-50">
          {visible.map((h) => (
            <Link
              key={h.player_id}
              href={`/players/${h.player_id}`}
              onClick={() => {
                setOpen(false);
                setQ("");
              }}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-panel-2 border-b border-rule last:border-0 no-underline"
            >
              {h.headshot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.headshot} alt="" width={26} height={26} className="rounded-full bg-panel-3 object-cover" />
              ) : (
                <span className="w-[26px] h-[26px] rounded-full bg-panel-3" />
              )}
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-ink truncate font-medium">{h.name}</span>
                <span className="block text-[11px] text-ink-3">
                  {[h.position, h.team, h.last_season].filter(Boolean).join(" · ")}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
