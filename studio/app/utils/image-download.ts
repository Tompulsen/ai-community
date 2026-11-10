export async function downloadImage(src: string, name = "image") {
  const url = new URL(src, window.location.href);
  if (!["http:", "https:", "data:", "blob:"].includes(url.protocol)) {
    throw new Error("Unsupported image URL");
  }
  const target =
    ["http:", "https:"].includes(url.protocol) &&
    url.origin !== window.location.origin
      ? `/studio/api/proxy-image?url=${encodeURIComponent(url.href)}`
      : url.href;
  const response = await fetch(target);
  if (!response.ok)
    throw new Error(`Image download failed (${response.status})`);
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("image/")) {
    throw new Error("Invalid image response");
  }
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
  };
  const extension = extensions[blob.type.split(";")[0]] || "img";
  const filename =
    name
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .slice(0, 100) || "image";
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${filename}.${extension}`;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Keep the URL alive until the browser has started reading the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
