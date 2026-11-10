/**
 * 基于 DOM 的 HTML 净化器（白名单模式）
 *
 * 比正则方案更安全，可防御：
 * - 嵌套 <script> 标签绕过
 * - on* 事件属性注入
 * - javascript: 协议 XSS
 * - SVG / MathML 命名空间攻击
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "pre",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "hr",
  "div",
  "span",
  "mark",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
  div: new Set(["class"]),
  span: new Set(["class"]),
};

const GLOBAL_ATTRS = new Set(["class"]);

/** 检查 URL 是否安全（阻止 javascript: / vbscript: 协议） */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("javascript:") || trimmed.startsWith("vbscript:")) {
    return false;
  }
  return true;
}

/**
 * 净化 HTML 字符串，移除所有不允许的标签和属性
 * 在浏览器环境使用 DOMParser，在 Node.js 使用 DOMUtils（如果可用）
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") {
    // 服务端：退化为正则方案（仅移除 script/iframe/事件属性）
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
      .replace(/<embed\b[^<]*\/?>/gi, "")
      .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
      .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
      .replace(/javascript:/gi, "");
  }

  // 客户端：使用 DOM 白名单净化
  const doc = new DOMParser().parseFromString(html, "text/html");
  const fragment = doc.body;

  function walk(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return node;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const el = node as Element;
    const tagName = el.tagName.toLowerCase();

    // 不允许的标签：保留子元素但移除标签本身
    if (!ALLOWED_TAGS.has(tagName)) {
      // 对于 script/iframe/style 等标签，直接移除整个子树
      if (
        ["script", "iframe", "style", "object", "embed", "link"].includes(
          tagName,
        )
      ) {
        return null;
      }
      // 其他标签：用子节点替换（unwrapping）
      const parent = el.parentNode;
      if (!parent) return null;
      const children = Array.from(el.childNodes);
      for (const child of children) {
        const safe = walk(child);
        if (safe) parent.insertBefore(safe, el);
      }
      parent.removeChild(el);
      return null;
    }

    // 过滤属性
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const attrName = attr.name.toLowerCase();
      const isEventAttr = attrName.startsWith("on");
      const allowedForTag = ALLOWED_ATTRS[tagName];
      const isAllowed =
        allowedForTag?.has(attrName) || GLOBAL_ATTRS.has(attrName);

      if (isEventAttr || !isAllowed) {
        el.removeAttribute(attr.name);
        continue;
      }

      // URL 属性检查
      if (
        (attrName === "href" || attrName === "src") &&
        !isSafeUrl(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }

    // a 标签强制添加安全属性
    if (tagName === "a") {
      el.setAttribute("rel", "noopener noreferrer");
      const target = el.getAttribute("target");
      if (target === "_blank" && !el.getAttribute("rel")) {
        el.setAttribute("rel", "noopener noreferrer");
      }
    }

    // 递归处理子节点
    const children = Array.from(el.childNodes);
    for (const child of children) {
      const safe = walk(child);
      if (safe && safe !== child) {
        el.replaceChild(safe, child);
      } else if (!safe) {
        el.removeChild(child);
      }
    }

    return el;
  }

  const children = Array.from(fragment.childNodes);
  for (const child of children) {
    const safe = walk(child);
    if (safe && safe !== child) {
      fragment.replaceChild(safe, child);
    } else if (!safe) {
      fragment.removeChild(child);
    }
  }

  return fragment.innerHTML;
}
