import type { NewApiGroup } from "../client/new-api";

export type MediaModelType = "image" | "video";

/** Group IDs and display names are supplied by this account's New API. */
export function modelGroupType(
  group?: Pick<NewApiGroup, "id" | "name"> | string | null,
): MediaModelType | undefined {
  const names = typeof group === "string" ? [group] : [group?.id, group?.name];
  for (const value of names) {
    const name = value?.trim().toLowerCase();
    if (
      ["生图", "生圖", "绘图", "繪圖", "image", "images"].includes(name ?? "")
    )
      return "image";
    if (["视频", "視頻", "video", "videos"].includes(name ?? ""))
      return "video";
  }
}
