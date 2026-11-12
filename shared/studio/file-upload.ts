import type { MultimodalContent, RequestMessage } from "./types.ts";

/** 支持的文件类型 */
export const SUPPORTED_FILE_TYPES = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "text/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".log": "text/plain",
  ".py": "text/x-python",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".jsx": "text/javascript",
  ".css": "text/css",
  ".scss": "text/x-scss",
  ".sql": "text/plain",
  ".vue": "text/plain",
  ".svelte": "text/plain",
  ".ipynb": "application/json",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".sh": "text/x-shellscript",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".rtf": "application/rtf",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 20 * 1024 * 1024;

export interface ParsedFile {
  name: string;
  type: string;
  size: number;
  content: string;
  isText: boolean;
}

/** 检查文件是否为支持的类型 */
export function isSupportedFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  return (
    ext in SUPPORTED_FILE_TYPES ||
    /^(?:text|image|video|audio)\//.test(file.type)
  );
}

/** 获取文件扩展名（小写） */
export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return "";
  return filename.slice(idx).toLowerCase();
}

/** Encode the original bytes for transport; do not interpret the document. */
async function readFileData(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onabort = () => reject(new Error("文件读取已取消"));
    reader.readAsDataURL(file);
  });
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = getFileExtension(file.name);
  if (!isSupportedFile(file)) throw new Error(`不支持的文件类型: ${ext}`);
  const type =
    (!file.type || file.type === "application/octet-stream"
      ? (SUPPORTED_FILE_TYPES as Record<string, string>)[ext]
      : file.type) || "application/octet-stream";
  const maxSize = type.startsWith("video/") ? MAX_VIDEO_SIZE : MAX_FILE_SIZE;
  if (file.size > maxSize) {
    throw new Error(`文件大小超过限制（最大 ${maxSize / 1024 / 1024}MB）`);
  }
  return {
    name: file.name,
    type,
    size: file.size,
    content: await readFileData(file.slice(0, file.size, type)),
    isText: false,
  };
}

export function audioDataUrl(
  audio: NonNullable<MultimodalContent["input_audio"]>,
): string {
  const format = audio.format.trim().toLowerCase();
  const declaredType = (SUPPORTED_FILE_TYPES as Record<string, string>)[
    `.${format}`
  ];
  const type = declaredType?.startsWith("audio/")
    ? declaredType
    : `audio/${format}`;
  return `data:${type};base64,${audio.data}`;
}

function audioFormat(file: ParsedFile): string {
  const type = file.type.split(";")[0].trim().toLowerCase();
  const match = Object.entries(SUPPORTED_FILE_TYPES).find(
    ([, mime]) => mime === type && mime.startsWith("audio/"),
  );
  if (match) return match[0].slice(1);
  if (type === "audio/x-wav" || type === "audio/wave") return "wav";
  return type.slice("audio/".length);
}

export function fileContentParts(files: ParsedFile[]): MultimodalContent[] {
  return files
    .filter((file) => !file.isText)
    .map((file) => {
      if (file.type.startsWith("video/"))
        return { type: "video_url", video_url: { url: file.content } };
      if (file.type.startsWith("audio/")) {
        return {
          type: "input_audio",
          input_audio: {
            data: file.content.slice(file.content.indexOf(",") + 1),
            format: audioFormat(file),
          },
        };
      }
      return {
        type: "file",
        file: { filename: file.name, file_data: file.content },
      };
    });
}

export function hasFileContent(messages: RequestMessage[]): boolean {
  return messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) =>
        ["file", "video_url", "input_audio"].includes(part.type),
      ),
  );
}

function dataUrlSize(content: string): number {
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(content);
  if (!match) return 0;
  return (
    Math.floor((match[1].length * 3) / 4) -
    (match[1].endsWith("==") ? 2 : match[1].endsWith("=") ? 1 : 0)
  );
}

export function formatMaterialSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Also handles imported/edited messages without composer metadata. */
export function messageFiles(
  message: RequestMessage & { composerInput?: { files: ParsedFile[] } },
): ParsedFile[] {
  if (message.composerInput) return message.composerInput.files;
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((part): ParsedFile[] => {
    const content =
      part.file?.file_data ||
      part.video_url?.url ||
      (part.input_audio && audioDataUrl(part.input_audio));
    if (!content) return [];
    return [
      {
        name:
          part.file?.filename ||
          (part.input_audio ? `audio.${part.input_audio.format}` : "video.mp4"),
        type:
          /^data:([^;,]+)/.exec(content)?.[1] ||
          (part.video_url ? "video/mp4" : "application/octet-stream"),
        size: dataUrlSize(content),
        content,
        isText: false,
      },
    ];
  });
}

/**
 * 将文件内容格式化为消息前缀
 */
export function formatFileContent(files: ParsedFile[]): string {
  if (files.length === 0) return "";
  const parts = files.map((f) => {
    if (!f.isText)
      return `--- 素材: ${f.name} (${formatMaterialSize(f.size)}) ---`;
    const header = `--- 文件: ${f.name} (${formatMaterialSize(f.size)}) ---`;
    return `${header}\n${f.content}\n--- 文件结束 ---`;
  });
  return parts.join("\n\n");
}

/**
 * 格式化文件 accept 属性
 */
export function getFileAccept(): string {
  return Object.keys(SUPPORTED_FILE_TYPES).join(",");
}
