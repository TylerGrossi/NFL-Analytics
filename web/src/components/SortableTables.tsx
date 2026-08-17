"use client";

import { useEffect } from "react";

/**
 * Makes every `.grid-table` on the site sortable, without touching a page.
 *
 * The alternative was to convert ~90 server-rendered tables into stateful
 * client components, which would have meant shipping every leaderboard's data
 * to the browser twice and rewriting each page's data flow. Instead this
 * enhances the markup that is already there: it reads the table the server
 * sent, wires the header cells, and reorders rows in place.
 *
 * That is safe here specifically because these tables live in server
 * components. Nothing on the client re-renders them after hydration, so React
 * never fights the row order. A client-side navigation replaces the whole
 * tree, and the observer below picks the new tables up.
 *
 * Columns opt out by having nothing sortable in them — a column of bars has no
 * text, so it never becomes a header you can click. A cell can override what
 * it sorts on with `data-sort`, which is how a column that displays one thing
 * and orders by another (a date, a record) stays correct.
 */

const SORTED = "data-sortable-wired";

/** Parse a cell into a number, or null when it isn't one. */
function toNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    // unicode minus, en dash and em dash all show up in formatted figures
    .replace(/[−–—]/g, "-")
    .replace(/[,%$\s]/g, "")
    .replace(/[^0-9.\-+eE]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellText(row: HTMLTableRowElement, index: number): string {
  const cell = row.cells[index];
  if (!cell) return "";
  return (cell.getAttribute("data-sort") ?? cell.textContent ?? "").trim();
}

function enhance(table: HTMLTableElement) {
  if (table.getAttribute(SORTED)) return;

  const head = table.tHead;
  const body = table.tBodies[0];
  if (!head || !body || head.rows.length === 0) return;

  // The last header row is the one that labels the columns; anything above it
  // is a grouping row. Grouped headers span columns, and a spanning header
  // does not map to a single column, so those tables are left alone.
  const headerRow = head.rows[head.rows.length - 1];
  const headers = Array.from(headerRow.cells);
  if (headers.some((th) => th.colSpan > 1)) return;

  table.setAttribute(SORTED, "1");

  const original = Array.from(body.rows);
  // 0 = as the server ordered it, 1 = first click, 2 = reversed
  const state = { column: -1, step: 0 };

  headers.forEach((th, index) => {
    const label = (th.textContent ?? "").trim();
    if (!label) return;

    const values = original
      .slice(0, 24)
      .map((row) => cellText(row, index))
      .filter((v) => v.length > 0 && v !== "-");
    if (values.length === 0) return;

    const numericCount = values.filter((v) => toNumber(v) !== null).length;
    const numeric = numericCount >= values.length * 0.6;

    th.setAttribute("data-sortable", "");
    th.setAttribute("role", "button");
    th.setAttribute("tabindex", "0");

    const run = () => {
      if (state.column === index) {
        state.step = (state.step + 1) % 3;
      } else {
        state.column = index;
        state.step = 1;
      }

      headers.forEach((other) => other.removeAttribute("aria-sort"));

      if (state.step === 0) {
        state.column = -1;
        original.forEach((row) => body.appendChild(row));
        return;
      }

      // A number column opens on its largest value, because the first thing
      // anyone wants from a stat column is the top of it. Text opens A–Z.
      const descending = numeric ? state.step === 1 : state.step === 2;

      const rows = Array.from(body.rows);
      rows.sort((a, b) => {
        const rawA = cellText(a, index);
        const rawB = cellText(b, index);

        if (numeric) {
          const numA = toNumber(rawA);
          const numB = toNumber(rawB);
          // Blanks and em dashes sink to the bottom either way — a missing
          // value is not a small value.
          if (numA === null && numB === null) return 0;
          if (numA === null) return 1;
          if (numB === null) return -1;
          return descending ? numB - numA : numA - numB;
        }

        if (!rawA && !rawB) return 0;
        if (!rawA) return 1;
        if (!rawB) return -1;
        const cmp = rawA.localeCompare(rawB, undefined, { numeric: true, sensitivity: "base" });
        return descending ? -cmp : cmp;
      });

      rows.forEach((row) => body.appendChild(row));
      th.setAttribute("aria-sort", descending ? "descending" : "ascending");
    };

    th.addEventListener("click", run);
    th.addEventListener("keydown", (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        run();
      }
    });
  });
}

function scan() {
  document.querySelectorAll<HTMLTableElement>("table.grid-table").forEach(enhance);
}

export function SortableTables() {
  useEffect(() => {
    scan();

    // Tables arrive after navigation, and after any panel that reveals one.
    // Reordering rows mutates the body too, but those tables already carry the
    // wired marker so the rescan is a cheap no-op rather than a loop.
    let queued = 0;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = window.requestAnimationFrame(() => {
        queued = 0;
        scan();
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      if (queued) window.cancelAnimationFrame(queued);
      observer.disconnect();
    };
  }, []);

  return null;
}
