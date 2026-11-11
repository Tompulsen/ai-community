// The community build must always use the signed-in user's New API account.
function validateEnvironment(env) {
  const origin = (key, https = false) => {
    try {
      const url = new URL(env[key] || "");
      if (!(https ? ["https:"] : ["http:", "https:"]).includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
      return url.origin;
    } catch { throw new Error(`${key} must be a valid ${https ? "HTTPS" : "HTTP(S)"} origin`); }
  };
  origin("NEW_API_BASE_URL");
  origin("NEW_API_PUBLIC_URL", true);
  const community = origin("COMMUNITY_SSO_ORIGIN", true);
  if (origin("STUDIO_PUBLIC_ORIGIN", true) !== community) throw new Error("The studio and community origins must match");
  for (const key of ["NEW_API_SESSION_SECRET", "COMMUNITY_SSO_SECRET"]) {
    if (!env[key] || env[key].length < 32) throw new Error(`${key} is required (at least 32 characters)`);
  }
  try {
    const url = new URL(env.NEW_API_REDIS_URL || "");
    if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname) throw new Error();
  } catch { throw new Error("NEW_API_REDIS_URL must configure persistent account sessions"); }
}
module.exports = { validateEnvironment };
if (require.main === module) {
  try { validateEnvironment(process.env); }
  catch (error) { console.error(`Studio configuration error: ${error.message}`); process.exit(1); }
}
