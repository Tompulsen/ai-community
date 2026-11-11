export function estimateTokenLength(text: string): number {
  const englishChars = text.replace(/[^\x00-\x7F]/g, "").length;
  const nonEnglishChars = text.length - englishChars;
  return Math.ceil(englishChars / 4) + Math.ceil(nonEnglishChars / 1.5);
}
