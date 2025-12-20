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
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  );
}

// =============================================================================
// API Configuration
// =============================================================================

/**
 * Get the API hostname.
 * Falls back to staging environment if not configured.
 */
export function getApiHostname(): string {
  return process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "staging.osmo.nvidia.com";
}

/**
 * Get the auth hostname.
 * Falls back to staging auth if not configured.
 */
export function getAuthHostname(): string {
  return process.env.NEXT_PUBLIC_OSMO_AUTH_HOSTNAME || "auth-staging.osmo.nvidia.com";
}

/**
 * Check if SSL is enabled.
 */
export function isSslEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
}

/**
 * Get the full API base URL.
 */
export function getApiBaseUrl(): string {
  const scheme = isSslEnabled() ? "https" : "http";
  return `${scheme}://${getApiHostname()}`;
}

/**
 * Get the full auth base URL.
 */
export function getAuthBaseUrl(): string {
  const scheme = isSslEnabled() ? "https" : "http";
  return `${scheme}://${getAuthHostname()}`;
}

// =============================================================================
// Auth Configuration
// =============================================================================

/**
 * Auth client secret (server-side only).
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
 * Maximum retry delay for React Query.
 */
export const QUERY_MAX_RETRY_DELAY_MS = 5000;
