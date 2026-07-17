export interface AuthClaims {
  role: string;
  /** auth.users id for user JWTs; undefined for service-role keys. */
  sub?: string;
}

export function claimsFromAuthHeader(header: string | null): AuthClaims | null {
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
    if (typeof payload.role !== "string") return null;
    return {
      role: payload.role,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
    };
  } catch {
    return null;
  }
}
