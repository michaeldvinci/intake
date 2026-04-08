import { NextRequest, NextResponse } from "next/server";

// Resolved at request time — works correctly whether running in Docker
// (API_INTERNAL_BASE=http://api:8080) or locally (falls back to NEXT_PUBLIC_API_BASE).
function apiBase(): string {
  return (
    process.env.API_INTERNAL_BASE ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "http://localhost:8080"
  );
}

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const path = segments.join("/");
  const search = req.nextUrl.search;
  const url = `${apiBase()}/${path}${search}`;

  const headers = new Headers();
  if (req.headers.get("content-type")) {
    headers.set("content-type", req.headers.get("content-type")!);
  }

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    // @ts-expect-error — Node 18+ fetch supports duplex
    duplex: "half",
  });

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export async function GET(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxy(req, params.proxy);
}
export async function POST(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxy(req, params.proxy);
}
export async function PUT(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxy(req, params.proxy);
}
export async function PATCH(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxy(req, params.proxy);
}
export async function DELETE(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxy(req, params.proxy);
}
