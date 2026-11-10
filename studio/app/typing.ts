export type Updater<T> = (updater: (value: T) => void) => void;

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export interface RequestMessage {
  role: MessageRole;
  content: string;
}

export type DalleQuality =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "standard"
  | "hd";
export type DalleStyle = "auto" | "vivid" | "natural";

export type ModelSize =
  | "1:1"
  | "3:2"
  | "2:3"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "21:9"
  | "auto"
  | "1024x1024"
  | "1792x1024"
  | "1024x1792"
  | "768x1344"
  | "864x1152"
  | "1344x768"
  | "1152x864"
  | "1440x720"
  | "720x1440"
  | "1536x1024"
  | "1024x1536"
  | "1280x720"
  | "720x1280";
