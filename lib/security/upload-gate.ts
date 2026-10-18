import { NextRequest, NextResponse } from "next/server";
import { siteGate, securityHeaders } from "./site-gate";
// Binary routes must retain their streaming bodies; passing them through Next's
// middleware body-cloner would buffer/truncate uploads and change cleanup races.
export function uploadGate(request: NextRequest) {
  const gate = siteGate(request.headers);
  if (!gate) return null;
  return new NextResponse("Private media unavailable.", {
    status: gate.status,
    headers: {
      ...securityHeaders(),
      "Cache-Control": "private, no-store",
      ...(gate.challenge
        ? {
            "WWW-Authenticate":
              'Basic realm="Mimi private staging", charset="UTF-8"',
          }
        : {}),
    },
  });
}
