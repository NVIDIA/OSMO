/**
 * HTTP Headers
 *
 * Custom HTTP headers used by the API.
 * Isolated to avoid circular dependencies with generated API types.
 */

export const Headers = {
  AUTH: "x-osmo-auth",
} as const;

export type Header = (typeof Headers)[keyof typeof Headers];
