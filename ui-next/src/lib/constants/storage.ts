/**
 * Storage Keys
 *
 * Keys used for localStorage/cookie storage.
 * Isolated to avoid circular dependencies with generated API types.
 */

export const StorageKeys = {
  ID_TOKEN: "IdToken",
  BEARER_TOKEN: "BearerToken",
  REFRESH_TOKEN: "RefreshToken",
  AUTH_SKIPPED: "authSkipped",
  SIDEBAR_COLLAPSED: "sidebarCollapsed",
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
