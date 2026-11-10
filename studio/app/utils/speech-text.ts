import { markdownToTxt } from "markdown-to-txt";

export function speechText(markdown: string): string {
  const prose = markdown
    .replace(
      /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|$(?![\s\S]))/gm,
      "",
    )
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  return markdownToTxt(prose)
    .replace(/https?:\/\/[^\s<>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
