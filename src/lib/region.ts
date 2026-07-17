/**
 * The active radar region (SPEC §4): persisted in localStorage, defaulted from
 * the browser locale, always validated against the app's supported set so a
 * stale value can never point at an unsupported region.
 */
const KEY = "radar-region";

export function loadRegion(supported: string[]): string {
  const fallback = supported.includes("US") ? "US" : (supported[0] ?? "US");
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && supported.includes(stored)) return stored;
    const country = (navigator.language || "en-US").split("-")[1]?.toUpperCase();
    if (country && supported.includes(country)) return country;
  } catch {
    // localStorage / navigator unavailable — fall through.
  }
  return fallback;
}

export function saveRegion(region: string): void {
  try {
    localStorage.setItem(KEY, region);
  } catch {
    // storage unavailable — region simply won't persist.
  }
}
