import { NextResponse } from "next/server";
import { getFourthDownPoint, getFourthDownRates, snapToGrid } from "@/lib/queries";

/** Looks up one precomputed situation. The grid is 1.3M rows; this is an index hit. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const snapped = snapToGrid({
    yardline: Number(p.get("yardline") ?? 50),
    ydstogo: Number(p.get("ydstogo") ?? 2),
    scoreDiff: Number(p.get("scoreDiff") ?? 0),
    seconds: Number(p.get("seconds") ?? 900),
  });

  try {
    const [point, rates] = await Promise.all([
      getFourthDownPoint(snapped.yardline, snapped.ydstogo, snapped.scoreDiff, snapped.seconds),
      getFourthDownRates(snapped.yardline, snapped.ydstogo),
    ]);
    if (!point) return NextResponse.json({ error: "outside grid" }, { status: 404 });
    return NextResponse.json({ ...point, ...rates, snapped });
  } catch {
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
