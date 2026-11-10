import webpack from "webpack";

const mode = process.env.BUILD_MODE ?? "standalone";
console.log("[Next] build mode", mode);

const disableChunk = !!process.env.DISABLE_CHUNK || mode === "export";
console.log("[Next] build with chunk: ", !disableChunk);

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/studio",
  outputFileTracingRoot: process.cwd(),
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    if (disableChunk) {
      config.plugins.push(
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      );
    }

    config.resolve.fallback = {
      child_process: false,
      bufferutil: false,
      "utf-8-validate": false,
    };

    return config;
  },
  output: mode,
  outputFileTracingIncludes: {
    "/*": ["./public/workspace-bootstrap.v1.js"],
  },
  images: {
    unoptimized: mode === "export",
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },
  experimental: {
    forceSwcTransforms: true,
    optimizePackageImports: ["clsx"],
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
};

const CorsHeaders = [
  { key: "Access-Control-Allow-Credentials", value: "true" },
  {
    key: "Access-Control-Allow-Origin",
    value:
      process.env.ALLOWED_ORIGIN ||
      process.env.VERCEL_URL ||
      "http://localhost:3000",
  },
  {
    key: "Access-Control-Allow-Methods",
    value: "GET, POST, PUT, DELETE, OPTIONS",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "Content-Type, Authorization, X-Requested-With",
  },
  {
    key: "Access-Control-Max-Age",
    value: "86400",
  },
];

// HTTP/3 (QUIC) 配置
// 通过 Alt-Svc 头广播 HTTP/3 支持，客户端如支持 QUIC 则优先使用
// 注意：Connection: keep-alive 并不会禁用 HTTP/2，HTTP/2 由 Nginx/CDN 层控制
const HTTP3Headers = [
  {
    key: "Alt-Svc",
    value: 'h3=":443"; ma=86400, h3-29=":443"; ma=86400',
  },
];

if (mode !== "export") {
  nextConfig.headers = async () => {
    return [
      {
        source: "/api/:path*",
        headers: [...CorsHeaders, ...HTTP3Headers],
      },
      {
        source: "/((?!community-embed$).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value:
              process.env.NODE_ENV === "production"
                ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' blob: data: https:; frame-src 'self' https:; frame-ancestors 'none';"
                : "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com; connect-src 'self' blob: data: http: https: ws: wss:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; frame-src 'self' https:;",
          },
          ...HTTP3Headers,
        ],
      },
    ];
  };

  nextConfig.rewrites = async () => {
    const ret = [
      {
        source: "/google-fonts/:path*",
        destination: "https://fonts.googleapis.com/:path*",
      },
      {
        source: "/sharegpt",
        destination: "https://sharegpt.com/api/conversations",
      },
    ];

    return {
      beforeFiles: ret,
    };
  };
}

export default nextConfig;
