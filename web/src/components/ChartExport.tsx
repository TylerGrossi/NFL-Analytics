"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * Wraps a server-rendered chart and adds a "PNG" button that saves it.
 *
 * The charts on this site are plain SVG emitted on the server, which is what
 * makes this cheap — there is no canvas library and no client-side chart
 * runtime to coax an image out of. Three things do have to be handled, and
 * each of them is silent if you get it wrong:
 *
 * 1. **CSS custom properties do not survive.** The SVG is coloured with
 *    `var(--c1)`, `var(--ink-3)` and so on. Those resolve against the document,
 *    and a serialised SVG loaded into an `Image` has no document — every line
 *    comes out black. So the computed colour of every node is copied onto the
 *    clone as a literal before serialising.
 * 2. **Transparent background renders black.** Canvas starts transparent and
 *    most viewers composite that onto black, so the export paints the panel
 *    colour first.
 * 3. **Web fonts are not embedded.** Rather than inline a font file, the clone
 *    falls back to a generic stack; the numbers stay tabular enough to read.
 *
 * Not used on the team quadrant: it draws club logos with `<image href>` from
 * a remote host, which taints the canvas and makes `toBlob` throw.
 */
export function ChartExport({
  filename,
  caption,
  children,
}: {
  filename: string;
  caption?: string;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function save() {
    const svg = host.current?.querySelector("svg");
    if (!svg) return;
    setState("working");
    try {
      await exportSvg(svg, filename, caption);
      setState("idle");
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2600);
    }
  }

  return (
    <div className="relative group" ref={host}>
      {children}
      <button
        onClick={save}
        disabled={state === "working"}
        className="absolute top-1 right-1 px-2 py-0.5 rounded-[3px] border border-rule bg-panel text-[10.5px] text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:border-rule-strong hover:text-ink"
        aria-label="Download this chart as a PNG"
      >
        {state === "working" ? "…" : state === "failed" ? "failed" : "PNG"}
      </button>
    </div>
  );
}

/** Copy every resolved paint property from the live tree onto the clone. */
function inlinePaint(live: SVGSVGElement, clone: SVGSVGElement) {
  const from = [live, ...Array.from(live.querySelectorAll<SVGElement>("*"))];
  const to = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
  const props = [
    "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-dasharray",
    "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight",
    "text-anchor",
  ] as const;

  from.forEach((node, i) => {
    const target = to[i];
    if (!target) return;
    const computed = getComputedStyle(node);
    for (const prop of props) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== "none" && value !== "normal") {
        target.style.setProperty(prop, value);
      }
    }
    // The document's web fonts are not available to a detached SVG.
    if (node.tagName === "text") {
      target.style.setProperty(
        "font-family",
        computed.fontFamily.includes("Mono")
          ? "ui-monospace, SFMono-Regular, Menlo, monospace"
          : "system-ui, -apple-system, Segoe UI, sans-serif"
      );
    }
  });
}

const SCALE = 2;
const PAD = 14;
const CAPTION_H = 26;

async function exportSvg(live: SVGSVGElement, filename: string, caption?: string) {
  const box = live.viewBox.baseVal;
  const w = box?.width || live.clientWidth || 620;
  const h = box?.height || live.clientHeight || 200;

  const clone = live.cloneNode(true) as SVGSVGElement;
  inlinePaint(live, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  // The export button itself must not appear in the export.
  clone.querySelectorAll("[data-no-export]").forEach((n) => n.remove());

  const styles = getComputedStyle(document.body);
  const panel = styles.getPropertyValue("--panel").trim() || "#ffffff";
  const ink3 = styles.getPropertyValue("--ink-3").trim() || "#78889d";
  const ink = styles.getPropertyValue("--ink").trim() || "#0c1725";

  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const img = await load(url);
    const cw = w + PAD * 2;
    const ch = h + PAD * 2 + (caption ? CAPTION_H : 0);
    const canvas = document.createElement("canvas");
    canvas.width = cw * SCALE;
    canvas.height = ch * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, PAD, PAD, w, h);

    // Attribution travels with the image, which is the point of exporting it.
    ctx.font = "600 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = ink;
    ctx.fillText("Hashmark", PAD, ch - 10);
    if (caption) {
      ctx.font = "11px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillStyle = ink3;
      const brand = ctx.measureText("Hashmark").width;
      ctx.fillText(`· ${caption}`, PAD + brand + 34, ch - 10);
    }

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("toBlob failed");
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${filename}.png`;
    a.click();
    URL.revokeObjectURL(href);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("svg failed to load"));
    img.src = src;
  });
}
