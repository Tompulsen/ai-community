import { isIP } from "node:net";

export function getClientIp(req: { headers: Headers }) {
  // Only trust a single address overwritten by the deployment's ingress proxy.
  if (
    process.env.TRUST_PROXY !== "true" &&
    process.env.NEW_API_TRUST_PROXY !== "true"
  ) {
    return "unknown";
  }
  const ip = req.headers.get("x-real-ip")?.trim() || "";
  return isIP(ip) ? ip.replace(/^::ffff:/, "") : "unknown";
}
