import { NextResponse } from "next/server";
import { searchPlayers } from "@/lib/queries";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json([]);
  try {
    return NextResponse.json(await searchPlayers(q, 12));
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
