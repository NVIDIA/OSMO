/**
 * Application-wide constants.
 *
 * Organize magic strings and numbers here to:
 * - Make them discoverable and searchable
 * - Enable IDE autocompletion
 * - Centralize changes when values update
 *
 * Files are split to avoid circular dependencies:
 * - storage.ts, headers.ts, roles.ts: No dependencies on generated types
 * - ui.ts: Depends on generated types (import separately if needed)
 */

// Core constants (no dependencies on generated types)
export * from "./storage";
export * from "./headers";
export * from "./roles";

// UI display constants that depend on generated types
// Import these directly from ./ui if you need them to avoid cycles
export * from "./ui";
