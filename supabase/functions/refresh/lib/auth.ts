export function roleFromAuthHeader(header: string | null): string | null {
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}
