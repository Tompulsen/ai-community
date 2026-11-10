import { NextRequest, NextResponse } from "next/server";
import {
  fetchPublicImage,
  PublicImageError,
} from "@/app/utils/public-image-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 图片代理 API
 * 解决跨域问题，允许前端 fetch 上游返回的图片 URL
 *
 * 用法：/api/proxy-image?url=https://example.com/image.jpg
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json(
      { error: "Missing url parameter" },
      { status: 400 },
    );
  }

  try {
    const response = await fetchPublicImage(imageUrl, request.signal);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET");
    headers.set("X-Accel-Buffering", "no");
    headers.set("X-Content-Type-Options", "nosniff");

    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error instanceof PublicImageError
            ? error.message
            : "Failed to fetch image",
      },
      { status: error instanceof PublicImageError ? error.status : 502 },
    );
  }
}
