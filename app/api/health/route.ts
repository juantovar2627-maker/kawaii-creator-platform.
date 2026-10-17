import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  // Availability only, with no dependency/account/configuration information.
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
