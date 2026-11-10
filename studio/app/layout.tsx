/* eslint-disable @next/next/no-page-custom-font */
import "./styles/globals.scss";
import "./styles/markdown.scss";
import "./styles/highlight.scss";
import { getClientConfig } from "./config/client";
import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleTagManager, GoogleAnalytics } from "@next/third-parties/google";
import { getServerSideConfig } from "./config/server";
import { UI_LOGO_SRC, UI_LOGO_SRC_SET } from "./icons/ui-logo";


export const metadata: Metadata = {
  title: "章鱼公益平台",
  description: "智能 AI 对话服务，支持多模态交互、图片上传、生图等",
  icons: {
    icon: [
      {
        url: "/studio/favicon.ico",
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
      {
        url: "/studio/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/studio/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
    ],
    apple: "/studio/macos.png",
  },
  appleWebApp: {
    title: "章鱼公益平台",
    statusBarStyle: "default",
    capable: true,
  },
  manifest: "/studio/site.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const serverConfig = getServerSideConfig();

  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href={UI_LOGO_SRC}
          imageSrcSet={UI_LOGO_SRC_SET}
          as="image"
          type="image/png"
          fetchPriority="high"
        />
        <link rel="preconnect" href="https://challenges.cloudflare.com" />
        <meta name="config" content={JSON.stringify(getClientConfig())} />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
        />
        <link
          rel="manifest"
          href="/studio/site.webmanifest"
          crossOrigin="use-credentials"
        ></link>
      </head>
      <body>
        {children}
        {serverConfig?.isVercel && (
          <>
            <SpeedInsights />
          </>
        )}
        {serverConfig?.gtmId && (
          <>
            <GoogleTagManager gtmId={serverConfig.gtmId} />
          </>
        )}
        {serverConfig?.gaId && (
          <>
            <GoogleAnalytics gaId={serverConfig.gaId} />
          </>
        )}
      </body>
    </html>
  );
}
