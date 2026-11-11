import { NextResponse } from "next/server";

export function middleware() {
  const response = NextResponse.next();
  let parent = "'none'";
  try {
    const url = new URL(process.env.COMMUNITY_SSO_ORIGIN || "");
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      parent = url.origin;
  } catch {}
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: data: https:; frame-src 'self' https:; frame-ancestors ${parent}; base-uri 'self'; object-src 'none'`,
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "same-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
export const config = { matcher: "/community-embed" };
