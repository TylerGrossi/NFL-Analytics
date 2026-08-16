import { NextResponse } from "next/server";
import { fetchGameSummary, fetchLiveGame } from "@/lib/live";
import { getFourthDownPoint, getFourthDownRates, snapToGrid } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Live game state, the fourth down call for the current spot, and the box.
 *
 * The decision is computed whether or not it is actually fourth down — on
 * first through third the client labels it as a look-ahead, which is what you
 * want while watching: the call before the situation arrives.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const [game, summary] = await Promise.all([fetchLiveGame(id), fetchGameSummary(id)]);
  if (!game) return NextResponse.json({ error: "game not found" }, { status: 404 });

  const p = game.possession;
  if (!p || p.yardline100 === null) {
    return NextResponse.json({ game, decision: null, summary });
  }

  const snapped = snapToGrid({
    yardline: p.yardline100,
    ydstogo: p.distance && p.distance > 0 ? p.distance : 1,
    scoreDiff: p.scoreDifferential,
    seconds: p.secondsRemaining,
  });

  try {
    const [point, rates] = await Promise.all([
      getFourthDownPoint(snapped.yardline, snapped.ydstogo, snapped.scoreDiff, snapped.seconds),
      getFourthDownRates(snapped.yardline, snapped.ydstogo),
    ]);
    if (!point) return NextResponse.json({ game, decision: null, summary });

    const options = [
      { key: "GO", value: point.wp_go },
      { key: "FIELD GOAL", value: point.wp_fg },
      { key: "PUNT", value: point.wp_punt },
    ].filter((o) => o.value !== null) as { key: string; value: number }[];
    options.sort((a, b) => b.value - a.value);

    return NextResponse.json({
      game,
      summary,
      decision: {
        ...point,
        ...rates,
        snapped,
        isFourthDown: p.down === 4,
        best: options[0]?.key ?? null,
        margin: options.length > 1 ? options[0].value - options[1].value : 0,
      },
    });
  } catch {
    return NextResponse.json({ game, decision: null, summary });
  }
}
