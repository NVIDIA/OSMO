/**
 * Simple logger that can be configured for different environments.
 *
 * In production, errors are logged. Warnings are suppressed unless debug mode is enabled.
 * In development, all logs are shown.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Log an error. Always logged.
 */
export function logError(message: string, ...args: unknown[]): void {
  console.error(`[OSMO] ${message}`, ...args);
}

/**
 * Log a warning. Only logged in development.
 */
export function logWarn(message: string, ...args: unknown[]): void {
  if (isDev) {
    console.warn(`[OSMO] ${message}`, ...args);
  }
}
