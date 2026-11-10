import type { InstalledSkill } from "../skills/catalog";

export type WebSearchMode = "off" | "quick" | "deep";

export function getWebSearchMode(
  session: { webSearchMode?: WebSearchMode },
  legacySkill?: Pick<InstalledSkill, "kind" | "enabled">,
): WebSearchMode {
  if (session.webSearchMode === "quick" || session.webSearchMode === "deep")
    return session.webSearchMode;
  if (session.webSearchMode === "off") return "off";
  return legacySkill?.kind === "web" && legacySkill.enabled ? "quick" : "off";
}
