import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/api/auth";

async function handle(
  req: NextRequest,
  context: { params: Promise<{ action: string; key: string[] }> },
) {
  const params = await context.params;
  const requestUrl = new URL(req.url);
  const endpoint = requestUrl.searchParams.get("endpoint");

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  // 认证校验
  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg || "未授权访问" },
      { status: 401 },
    );
  }

  // only allow to request to *.upstash.io
  if (!endpoint || !new URL(endpoint).hostname.endsWith(".upstash.io")) {
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + params.key.join("/"),
      },
      {
        status: 403,
      },
    );
  }

  // only allow upstash get and set method
  if (params.action !== "get" && params.action !== "set") {
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + params.action,
      },
      {
        status: 403,
      },
    );
  }

  const targetUrl = `${endpoint}/${params.action}/${params.key.join("/")}`;

  const method = req.method;
  const shouldNotHaveBody = ["get", "head"].includes(
    method?.toLowerCase() ?? "",
  );

  const fetchOptions: RequestInit = {
    headers: {
      authorization: req.headers.get("authorization") ?? "",
    },
    body: shouldNotHaveBody ? null : req.body,
    method,
    // @ts-ignore
    duplex: "half",
  };

  const fetchResult = await fetch(targetUrl, fetchOptions);

  return fetchResult;
}

export const POST = handle;
export const GET = handle;
export const OPTIONS = handle;

export const runtime = "nodejs";
