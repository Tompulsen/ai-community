import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { pipeline, Readable, Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const privateIPv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  privateIPv4.addSubnet(address, prefix, "ipv4");
const publicIPv6 = new BlockList();
publicIPv6.addSubnet("2000::", 3, "ipv6");
const specialIPv6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  specialIPv6.addSubnet(address, prefix, "ipv6");

export class PublicImageError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function publicAddress(address: string) {
  if (address.includes("%")) return false;
  return isIP(address) === 4
    ? !privateIPv4.check(address, "ipv4")
    : isIP(address) === 6 &&
        publicIPv6.check(address, "ipv6") &&
        !specialIPv6.check(address, "ipv6");
}

function imageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicImageError("Invalid image URL", 400);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    (isIP(hostname) && !publicAddress(hostname))
  )
    throw new PublicImageError("Image destination is not allowed", 400);
  return url;
}

function connect(url: URL, signal: AbortSignal, kind: "image" | "video") {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: "GET",
        signal,
        // Never inherit client credentials, cookies, or proxy environment variables.
        headers: {
          "User-Agent": "OctopusChat/1.0",
          Accept: `${kind}/*`,
          "Accept-Encoding": "identity",
        },
        agent: false,
        // Resolve once and connect to that checked address, preventing DNS rebinding.
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true, verbatim: true }).then(
            (addresses) => {
              if (
                !addresses.length ||
                addresses.some((item) => !publicAddress(item.address))
              ) {
                callback(
                  new PublicImageError("Image destination is not allowed", 400),
                  "",
                  4,
                );
                return;
              }
              if ((options as { all?: boolean }).all) {
                (callback as Function)(null, addresses);
              } else {
                callback(null, addresses[0].address, addresses[0].family);
              }
            },
            (error) => callback(error, "", 4),
          );
        },
      },
      resolve,
    );
    request.setTimeout(15000, () =>
      request.destroy(new PublicImageError("Image fetch timeout", 504)),
    );
    request.once("error", reject);
    request.end();
  });
}

/** Public raster images only; validates and pins the destination at every hop. */
export function fetchPublicImage(source: string, signal?: AbortSignal) {
  return fetchPublicMedia(source, "image", MAX_IMAGE_BYTES, signal);
}

export async function fetchPublicMedia(source: string, kind: "image" | "video", maxBytes: number, signal?: AbortSignal) {
  const allowed = kind === "image" ? IMAGE_TYPES : new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]);
  const limitMessage =
    kind === "image"
      ? "Image exceeds the import limit"
      : "Video exceeds the import limit";
  let url = imageUrl(source);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, kind === "video" ? 120000 : 60000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const cleanup = () => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  };
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await connect(url, controller.signal, kind);
      const status = response.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy();
        if (!response.headers.location || redirects >= 5)
          throw new PublicImageError("Too many image redirects", 502);
        url = imageUrl(new URL(response.headers.location, url).href);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new PublicImageError(`Upstream returned ${status}`, status);
      }
      const type = (response.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!allowed.has(type)) {
        response.destroy();
        throw new PublicImageError(
          "Upstream did not return a supported image",
          415,
        );
      }
      const length = response.headers["content-length"];
      if (length && Number(length) > maxBytes) {
        response.destroy();
        throw new PublicImageError(limitMessage, 413);
      }
      const encoding = response.headers["content-encoding"]?.toLowerCase();
      const decoder =
        encoding === "gzip"
          ? createGunzip()
          : encoding === "deflate"
          ? createInflate()
          : encoding === "br"
          ? createBrotliDecompress()
          : undefined;
      if (encoding && encoding !== "identity" && !decoder) {
        response.destroy();
        throw new PublicImageError("Unsupported image encoding", 415);
      }
      let received = 0;
      const limited = new Transform({
        transform(chunk, _encoding, done) {
          received += chunk.length;
          done(
            received > maxBytes
              ? new PublicImageError(limitMessage, 413)
              : null,
            chunk,
          );
        },
      });
      limited.once("close", cleanup);
      if (decoder) pipeline(response, decoder, limited, () => {});
      else pipeline(response, limited, () => {});
      const headers = new Headers({ "Content-Type": type });
      if (!decoder && length && /^[1-9]\d*$/.test(length)) {
        headers.set("Content-Length", length);
        headers.set("X-Image-Content-Length", length);
      }
      return new Response(Readable.toWeb(limited) as ReadableStream, {
        headers,
      });
    }
  } catch (error) {
    cleanup();
    if (controller.signal.aborted)
      throw new PublicImageError("Image fetch timeout", 504);
    throw error;
  }
}
