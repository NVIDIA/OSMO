const STORAGE_KEY = "osmo:recent-workflows";
const MAX_RECENT = 10;

export function getRecentWorkflows(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to load recent workflows:", error);
    return [];
  }
}

export function addRecentWorkflow(workflowId: string): void {
  if (typeof window === "undefined") return;

  try {
    const recent = getRecentWorkflows();

    // Remove if already exists (to move to front)
    const filtered = recent.filter((id) => id !== workflowId);

    // Add to front
    const updated = [workflowId, ...filtered].slice(0, MAX_RECENT);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save recent workflow:", error);
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
