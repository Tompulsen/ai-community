export type MotionPreference = "system" | "full" | "reduced";

export function getMotionPreference(config: {
  motionPreference?: unknown;
  reduceMotion?: unknown;
}): MotionPreference {
  if (
    config.motionPreference === "system" ||
    config.motionPreference === "full" ||
    config.motionPreference === "reduced"
  )
    return config.motionPreference;
  return config.reduceMotion === true ? "reduced" : "system";
}

export function prefersReducedMotion() {
  if (typeof document === "undefined") return false;
  const preference = document.body?.dataset.motion;
  if (preference === "full") return false;
  return (
    preference === "reduced" ||
    !!document.body?.classList.contains("reduce-motion") ||
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}
