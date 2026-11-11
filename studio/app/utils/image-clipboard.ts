import { showToast } from "../components/ui-lib";

async function clipboardPng(blob: Blob): Promise<Blob> {
  if (!blob.size) throw new Error("Empty image");
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion unavailable");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (png) =>
          png ? resolve(png) : reject(new Error("Image conversion failed")),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}

export async function copyImageToClipboard(load: () => Promise<Blob>) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
      throw new Error("Image clipboard unavailable");
    // Start the clipboard write during the click, before fetching or converting.
    const png = load().then(clipboardPng);
    void png.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    showToast("图片已复制");
    return true;
  } catch {
    showToast("复制图片失败，请下载图片后使用");
    return false;
  }
}
