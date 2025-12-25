/**
 * Token Utilities
 *
 * Pure functions for JWT token parsing and validation.
 * Provider-agnostic - works with any OAuth2/OIDC provider.
 */

export interface AuthClaims {
  email?: string;
  preferred_username?: string;
  exp?: number;
  roles?: string[];
}

/**
 * Parse JWT token claims.
 */
export function parseJwtClaims(token?: string): AuthClaims | null {
  if (!token) return null;

  try {
    const parts = token.split(".");
    if (!parts[1]) return null;
    return JSON.parse(atob(parts[1])) as AuthClaims;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired.
 */
export function isTokenExpired(claims: AuthClaims | null): boolean {
  if (!claims?.exp) return true;
  return Date.now() >= claims.exp * 1000;
}

/**
 * Check if token expires within the given threshold (in seconds).
 */
export function isTokenExpiringSoon(token: string, thresholdSeconds: number): boolean {
  const claims = parseJwtClaims(token);
  if (!claims?.exp) return true;
  const expiresIn = claims.exp * 1000 - Date.now();
  return expiresIn < thresholdSeconds * 1000;
}
