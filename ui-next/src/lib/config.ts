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

// =============================================================================
// BasePath Configuration
// =============================================================================

/**
 * Get the basePath for the application.
 *
 * This should match the basePath configured in next.config.ts.
 * The basePath is exposed via NEXT_PUBLIC_BASE_PATH environment variable
 * (set in next.config.ts env config).
 *
 * In client-side code, this can also be detected from window.location.pathname
 * as a fallback, but the env var is more reliable.
 *
 * @returns The basePath (e.g., "/v2") or empty string if no basePath
 */
export function getBasePath(): string {
  // First, check environment variable (set by next.config.ts)
  // This is the most reliable source
  if (process.env.NEXT_PUBLIC_BASE_PATH) {
    return process.env.NEXT_PUBLIC_BASE_PATH;
  }

  // In client-side code, try to detect from current pathname
  // This is a fallback for cases where env var isn't available
  if (typeof window !== "undefined") {
    const pathname = window.location.pathname;

    // Match basePath patterns: /v2, /v2/, /v2/pools, etc.
    // Extract the first segment that looks like a version path (/v2, /v3, etc.)
    const match = pathname.match(/^\/(v\d+)(?:\/|$)/);
    if (match) {
      return `/${match[1]}`;
    }

    // Also check if we're at the root with a basePath (e.g., /v2 with no trailing slash)
    // This handles the case where pathname is exactly "/v2"
    if (pathname.match(/^\/v\d+$/)) {
      return pathname;
    }

    // Check the base element if present (Next.js sometimes sets this)
    const baseElement = document.querySelector("base[href]");
    if (baseElement) {
      const baseHref = baseElement.getAttribute("href");
      if (baseHref && baseHref !== "/") {
        try {
          const baseUrl = new URL(baseHref, window.location.origin);
          const basePath = baseUrl.pathname;
          if (basePath && basePath !== "/") {
            // Remove trailing slash
            return basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
          }
        } catch {
          // Invalid URL, ignore
        }
      }
    }
  }

  // Default: no basePath (empty string)
  // This matches next.config.ts default if basePath is not set
  return "";
}

/**
 * Prepend basePath to a URL path if basePath is configured.
 *
 * This ensures all client-side URLs are basePath-aware.
 * API rewrites in next.config.ts handle /api/* routes before basePath is applied,
 * but being explicit here makes the code more maintainable.
 *
 * @param path - The path to prepend basePath to (should start with /)
 * @returns The path with basePath prepended if basePath is configured
 *
 * @example
 * ```ts
 * getBasePathUrl("/api/workflow") // "/v2/api/workflow" if basePath is "/v2"
 * getBasePathUrl("/auth/login_info") // "/v2/auth/login_info" if basePath is "/v2"
 * ```
 */
export function getBasePathUrl(path: string): string {
  const basePath = getBasePath();
  if (!basePath) {
    return path;
  }

  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  // Ensure basePath doesn't end with /
  const normalizedBasePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;

  return `${normalizedBasePath}${normalizedPath}`;
}

/**
 * Remove basePath prefix from a URL path if basePath is configured.
 *
 * This is useful when you need to pass URLs to Next.js router methods (push, replace, etc.)
 * which automatically add the basePath. Without stripping, you'd get double basePath
 * (e.g., "/v2/v2/pools" instead of "/v2/pools").
 *
 * Common use case: Converting DOM hrefs (which include basePath) to router-compatible paths.
 *
 * @param path - The path to strip basePath from (should start with /)
 * @returns The path with basePath removed if it was present
 *
 * @example
 * ```ts
 * stripBasePath("/v2/pools") // "/pools" if basePath is "/v2"
 * stripBasePath("/pools")    // "/pools" if basePath is "/v2" (no basePath to strip)
 * stripBasePath("/v2")       // "/" if basePath is "/v2"
 * ```
 */
export function stripBasePath(path: string): string {
  const basePath = getBasePath();
  if (!basePath || !path.startsWith(basePath)) {
    return path;
  }

  // Strip the basePath
  const stripped = path.slice(basePath.length);

  // Ensure result starts with / (or is "/" if empty)
  return stripped || "/";
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
 * Auth is handled by Envoy sidecar in production.
 * Envoy injects the x-osmo-user header and forwards the Bearer token.
 *
 * To access user info and roles, decode the JWT from the Authorization header.
 */

// =============================================================================
// Timing Constants
// =============================================================================

/**
 * How long to show "copied" feedback in UI.
 */
export const COPY_FEEDBACK_DURATION_MS = 2000;

/**
 * Default stale time for React Query.
 * Increased to 2 minutes for better handling of slow/unreliable networks.
 */
export const QUERY_STALE_TIME_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Granular stale time constants for different data volatility levels.
 * Use these for more precise cache control based on data characteristics.
 */
export const QUERY_STALE_TIME = {
  /** Realtime data (30s) - for live/frequently changing data (running workflows, active tasks) */
  REALTIME: 30_000,
  /** Standard data (2min) - for semi-static data (workflow details, pool quotas) */
  STANDARD: 2 * 60_000,
  /** Static data (10min) - for rarely changing data (version info, platform configs) */
  STATIC: 10 * 60_000,
} as const;

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

// =============================================================================
// UI Layout Constants
// =============================================================================

/**
 * Standard table row heights in pixels.
 *
 * These are the canonical values used across all tables in the application.
 * CSS variables should derive from these (or vice versa, staying consistent).
 *
 * Note: 48px = 3rem, 36px = 2.25rem, 32px = 2rem at 16px base.
 */
export const TABLE_ROW_HEIGHTS = {
  /** Standard row height - good for touch targets and readability */
  NORMAL: 48,
  /** Compact row height - for dense data displays */
  COMPACT: 36,
  /** Extra compact row height - for very dense data */
  COMPACT_SM: 32,
  /** Section header height */
  SECTION: 36,
  /** Table header height */
  HEADER: 44,
} as const;
