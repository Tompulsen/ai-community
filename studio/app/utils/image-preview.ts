import { getLocalScope } from "./local-workspace";

export interface ImagePreview {
  key: string;
  url: string;
  width: number;
  height: number;
  decoded: HTMLImageElement;
  users: number;
}

const previews = new Map<string, ImagePreview>();
const MAX_PREVIEWS = 4;
const MAX_PIXELS = 24 * 1024 * 1024;

export function imagePreviewKey(
  src: string,
  imageId?: string,
  scope: string = getLocalScope(),
) {
  const id = imageId ?? "";
  // Length prefixes keep arbitrary identifiers unambiguous without escaping
  // or serializing multi-megabyte data URLs.
  return `${scope.length}:${scope}${id.length}:${id}${src.length}:${src}`;
}

export function getImagePreview(key: string) {
  return previews.get(key);
}

function trimPreviews() {
  let pixels = [...previews.values()].reduce(
    (sum, preview) => sum + preview.width * preview.height,
    0,
  );
  for (const [key, preview] of previews) {
    if (previews.size <= MAX_PREVIEWS && pixels <= MAX_PIXELS) break;
    if (preview.users) continue;
    previews.delete(key);
    pixels -= preview.width * preview.height;
    URL.revokeObjectURL(preview.url);
  }
}

export function retainImagePreview(preview: ImagePreview) {
  preview.users++;
  if (previews.get(preview.key) === preview) {
    previews.delete(preview.key);
    previews.set(preview.key, preview);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    preview.users--;
    if (!preview.users && previews.get(preview.key) !== preview)
      URL.revokeObjectURL(preview.url);
    trimPreviews();
  };
}

export async function decodeImagePreview(key: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const decoded = new Image();
  try {
    decoded.src = url;
    await decoded.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const preview: ImagePreview = {
    key,
    url,
    width: decoded.naturalWidth,
    height: decoded.naturalHeight,
    decoded,
    users: 0,
  };
  const release = retainImagePreview(preview);
  // Replacing a retry result must not revoke an older preview still on screen.
  const previous = previews.get(key);
  if (previous && !previous.users) URL.revokeObjectURL(previous.url);
  previews.delete(key);
  previews.set(key, preview);
  trimPreviews();
  return { preview, release };
}
