/**
 * User Roles
 *
 * Known user roles in the system.
 * These are embedded in JWT tokens and control access.
 *
 * Note: Roles are dynamic and fetched from backend via /api/configs/role.
 * These constants are the well-known roles for quick checks.
 */

export const Roles = {
  // Core OSMO roles
  OSMO_ADMIN: "osmo-admin",
  OSMO_USER: "osmo-user",
  OSMO_SRE: "osmo-sre",

  // Dashboard-specific roles
  DASHBOARD_ADMIN: "dashboard-admin",
  DASHBOARD_USER: "dashboard-user",

  // Monitoring roles
  GRAFANA_ADMIN: "grafana-admin",
  GRAFANA_USER: "grafana-user",
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

/**
 * Check if roles array contains any admin role.
 */
export function hasAdminRole(roles: string[]): boolean {
  return roles.includes(Roles.OSMO_ADMIN) || roles.includes(Roles.DASHBOARD_ADMIN);
}

/**
 * Check if roles array contains any user role.
 */
export function hasUserRole(roles: string[]): boolean {
  return roles.includes(Roles.OSMO_USER) || roles.includes(Roles.DASHBOARD_USER);
}
