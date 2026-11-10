import md5 from "spark-md5";
import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { auth } from "@/app/api/auth";

async function handle(req: NextRequest) {
  // 认证校验
  const authResult = await auth(req);
  if (authResult.error) {
    return NextResponse.json(
      { error: true, msg: authResult.msg || "未授权访问" },
      { status: 401 },
    );
  }

  const serverConfig = getServerSideConfig();
  const storeUrl = () =>
    `https://api.cloudflare.com/client/v4/accounts/${serverConfig.cloudflareAccountId}/storage/kv/namespaces/${serverConfig.cloudflareKVNamespaceId}`;
  const storeHeaders = () => ({
    Authorization: `Bearer ${serverConfig.cloudflareKVApiKey}`,
  });
  if (req.method === "POST") {
    const clonedBody = await req.text();
    const hashedCode = md5.hash(clonedBody).trim();
    const body: {
      key: string;
      value: string;
      expiration_ttl?: number;
    } = {
      key: hashedCode,
      value: clonedBody,
    };
    try {
      const ttl = parseInt(serverConfig.cloudflareKVTTL as string);
      if (ttl > 60) {
        body["expiration_ttl"] = ttl;
      }
    } catch (e) {
      console.error(e);
    }
    const res = await fetch(`${storeUrl()}/bulk`, {
      headers: {
        ...storeHeaders(),
        "Content-Type": "application/json",
      },
      method: "PUT",
      body: JSON.stringify([body]),
    });
    const result = await res.json();
    if (result?.success) {
      return NextResponse.json(
        { code: 0, id: hashedCode, result },
        { status: res.status },
      );
    }
    return NextResponse.json(
      { error: true, msg: "Save data error" },
      { status: 400 },
    );
  }
  if (req.method === "GET") {
    const id = req?.nextUrl?.searchParams?.get("id");
    if (!id || id.length !== 32 || !/^[0-9a-f]{32}$/.test(id)) {
      return NextResponse.json(
        { error: true, msg: "Invalid artifact ID" },
        { status: 400 },
      );
    }
    const res = await fetch(`${storeUrl()}/values/${id}`, {
      headers: storeHeaders(),
      method: "GET",
    });
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  return NextResponse.json(
    { error: true, msg: "Invalid request" },
    { status: 400 },
  );
}

export const POST = handle;
export const GET = handle;

export const runtime = "nodejs";
