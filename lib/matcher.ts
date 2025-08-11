import stringSimilarity from "string-similarity";

export const normalize = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9\s:]/g, "")
    .replace(/:\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const isMatch = (rssTitle: string, storeTitle: string, threshold = 0.82) => {
  const A = normalize(rssTitle),
    B = normalize(storeTitle);
  if (!A || !B) return false;
  if (A.includes(B)) return true;
  return stringSimilarity.compareTwoStrings(A, B) >= threshold;
};
