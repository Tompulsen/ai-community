/** @jest-environment node */
import { jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.unstable_mockModule("@/app/config/client", () => ({ getClientConfig: () => ({ buildMode: "standalone" }) }));
jest.unstable_mockModule("@/app/config/server", () => ({ getServerSideConfig: () => ({}) }));
jest.unstable_mockModule("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));
jest.unstable_mockModule("@next/third-parties/google", () => ({ GoogleTagManager: () => null, GoogleAnalytics: () => null }));
const { default: RootLayout } = await import("../app/layout");

test("community studio waits for verified identity and never registers an origin-wide worker", () => {
  const html = renderToStaticMarkup(RootLayout({ children: null }));
  expect(html).not.toContain("workspace-bootstrap");
  expect(html).not.toContain("serviceWorkerRegister");
  expect(html).toContain("/studio/ui-logo-64.png");
  expect(html).toContain("/studio/site.webmanifest");
});
