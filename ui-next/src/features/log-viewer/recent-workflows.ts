const STORAGE_KEY = "osmo:recent-workflows";
const MAX_RECENT = 10;

/**
 * Sanitize a workflow ID by removing any URL query parameters.
 * E.g., "mock-workflow-1&debug=timeline" becomes "mock-workflow-1"
 */
function sanitizeWorkflowId(id: string): string {
  return id.split("&")[0].split("?")[0].trim();
}

export function getRecentWorkflows(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    // Sanitize any malformed workflow IDs that might exist in storage
    const sanitized = parsed.map((id) => sanitizeWorkflowId(id)).filter((id) => id.length > 0);

    // Remove duplicates (in case sanitization created duplicates)
    const unique = Array.from(new Set(sanitized));

    // If we sanitized anything, update storage
    if (JSON.stringify(unique) !== JSON.stringify(parsed)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
    }

    return unique;
  } catch (error) {
    console.error("Failed to load recent workflows:", error);
    return [];
  }
}

export function addRecentWorkflow(workflowId: string): void {
  if (typeof window === "undefined") return;

  try {
    // Sanitize workflow ID: if it contains URL query params (e.g., "mock-workflow-1&debug=timeline"),
    // extract just the workflow ID part before the first "&"
    // This prevents double-encoding issues when clicking recent workflows
    const sanitizedId = sanitizeWorkflowId(workflowId);

    // Skip if empty after sanitization
    if (!sanitizedId) return;

    const recent = getRecentWorkflows();

    // Remove if already exists (to move to front)
    const filtered = recent.filter((id) => id !== sanitizedId);

    // Add to front
    const updated = [sanitizedId, ...filtered].slice(0, MAX_RECENT);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save recent workflow:", error);
  }
}

export function removeRecentWorkflow(workflowId: string): void {
  if (typeof window === "undefined") return;

  try {
    const recent = getRecentWorkflows();
    const filtered = recent.filter((id) => id !== workflowId);

    if (filtered.length === recent.length) {
      // Nothing to remove
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error("Failed to remove recent workflow:", error);
  }
}

export function clearRecentWorkflows(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear recent workflows:", error);
  }
}
