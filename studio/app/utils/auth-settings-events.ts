import { sendGAEvent } from "@next/third-parties/google";

export function trackSettingsPageGuideToCPaymentClick() {
  sendGAEvent("event", "SettingsPageGuideToCPaymentClick", { value: 1 });
}
