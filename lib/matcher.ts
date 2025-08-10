import stringSimilarity from "string-similarity";

export const normalize = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s:]/g, "")
    .replace(/:\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function isMatch(a: string, b: string, threshold = 0.82) {
  const A = normalize(a),
    B = normalize(b);
  if (!A || !B) return false;
  if (A === B) return true;
  return stringSimilarity.compareTwoStrings(A, B) >= threshold;
}
