import { CommunityEmbed } from "./workspace";
export const dynamic = "force-dynamic";
export default function Page() {
  const value = process.env.COMMUNITY_SSO_ORIGIN || "";
  let origin = "";
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    )
      origin = url.origin;
  } catch {}
  return <CommunityEmbed communityOrigin={origin} />;
}
