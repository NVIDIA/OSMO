/**
 * Centralized configuration for the OSMO UI.
 *
 * All environment variables and runtime config should be accessed through this module.
 * This ensures consistent defaults and makes configuration discoverable.
 */

// =============================================================================
// Environment Detection
// =============================================================================

/**
 * Check if running in local development mode.
 */
export function isLocalDev(): boolean {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Check if running in a build phase (SSG/SSR).
 */
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build" || process.env.NEXT_PHASE === "phase-export";
}

/**
 * Check if mock mode is enabled via environment variable.
 * This works both client-side and server-side.
 */
export function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_MOCK_API === "true";
}

// =============================================================================
// API Configuration
// =============================================================================

/**
 * Get the configured API hostname.
 * Set NEXT_PUBLIC_OSMO_API_HOSTNAME in .env.local
 */
export function getApiHostname(): string {
  return process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
}

/**
 * Get the auth hostname.
 * Set NEXT_PUBLIC_OSMO_AUTH_HOSTNAME in .env.local
 */
export function getAuthHostname(): string {
  return process.env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME || "localhost:8081";
}

/**
 * Check if SSL is enabled.
 *
 * Defaults to false for localhost (no SSL certs typically available),
 * true for all other hostnames.
 */
export function isSslEnabled(): boolean {
  const explicit = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED;
  if (explicit !== undefined) {
    return explicit !== "false";
  }

  // Default: disable SSL for localhost, enable for everything else
  const hostname = getApiHostname();
  const isLocalhost = hostname.startsWith("localhost") || hostname.startsWith("127.0.0.1");
  return !isLocalhost;
}

// =============================================================================
// Auth Configuration
// =============================================================================

/**
 * Auth client secret (server-side only).
 *
 * Configure AUTH_CLIENT_SECRET in .env.local
 */
export function getAuthClientSecret(): string {
  return process.env.AUTH_CLIENT_SECRET || "";
}

// =============================================================================
// Timing Constants
// =============================================================================

/**
 * How long to show "copied" feedback in UI.
 */
export const COPY_FEEDBACK_DURATION_MS = 2000;

/**
 * Default stale time for React Query.
 */
export const QUERY_STALE_TIME_MS = 60 * 1000; // 1 minute

/**
 * Stale time for expensive queries (e.g., all resources across pools).
 */
export const QUERY_STALE_TIME_EXPENSIVE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Maximum retry delay for React Query.
 */
export const QUERY_MAX_RETRY_DELAY_MS = 5000;

/**
 * Refresh token this many seconds before it expires (lazy refresh in fetcher).
 */
export const TOKEN_REFRESH_THRESHOLD_SECONDS = 60;
