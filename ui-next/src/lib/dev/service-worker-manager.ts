// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Service Worker Management Utilities
 *
 * Provides utilities for managing service workers in development.
 * Primarily used to clear old service workers that may interfere with hot reload.
 *
 * When MSW service worker is registered with wrong scope (root instead of /api/),
 * it can intercept static assets and break hot reload. This utility helps clean that up.
 */

/**
 * Unregister all service workers.
 * This clears any service workers that may be interfering with development.
 *
 * @returns Promise that resolves when all service workers are unregistered
 */
export async function unregisterAllServiceWorkers(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    console.warn("[Service Worker] Not available in this environment");
    return;
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();

    if (registrations.length === 0) {
      console.log("[Service Worker] No service workers registered");
      return;
    }

    console.log(`[Service Worker] Found ${registrations.length} service worker(s), unregistering...`);

    await Promise.all(
      registrations.map(async (registration) => {
        const scope = registration.scope;
        const success = await registration.unregister();
        if (success) {
          console.log(`[Service Worker] Unregistered: ${scope}`);
        } else {
          console.warn(`[Service Worker] Failed to unregister: ${scope}`);
        }
      }),
    );

    console.log("[Service Worker] All service workers unregistered");
  } catch (error) {
    console.error("[Service Worker] Error unregistering service workers:", error);
    throw error;
  }
}

/**
 * Clear all caches managed by the Cache API.
 * This helps ensure fresh assets after service worker cleanup.
 *
 * @returns Promise that resolves when all caches are deleted
 */
export async function clearAllCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) {
    console.warn("[Cache] Cache API not available");
    return;
  }

  try {
    const cacheNames = await caches.keys();

    if (cacheNames.length === 0) {
      console.log("[Cache] No caches found");
      return;
    }

    console.log(`[Cache] Found ${cacheNames.length} cache(s), deleting...`);

    await Promise.all(
      cacheNames.map(async (cacheName) => {
        const success = await caches.delete(cacheName);
        if (success) {
          console.log(`[Cache] Deleted: ${cacheName}`);
        } else {
          console.warn(`[Cache] Failed to delete: ${cacheName}`);
        }
      }),
    );

    console.log("[Cache] All caches cleared");
  } catch (error) {
    console.error("[Cache] Error clearing caches:", error);
    throw error;
  }
}

/**
 * Get status of all registered service workers.
 *
 * @returns Promise that resolves to array of service worker info
 */
export async function getServiceWorkerStatus(): Promise<
  Array<{
    scope: string;
    state: string;
    scriptURL: string;
  }>
> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return [];
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();

    return registrations.map((registration) => ({
      scope: registration.scope,
      state: registration.active?.state || registration.installing?.state || registration.waiting?.state || "unknown",
      scriptURL:
        registration.active?.scriptURL ||
        registration.installing?.scriptURL ||
        registration.waiting?.scriptURL ||
        "unknown",
    }));
  } catch (error) {
    console.error("[Service Worker] Error getting status:", error);
    return [];
  }
}

/**
 * Complete cleanup: unregister service workers, clear caches, and reload.
 * This is the main function developers should call when hot reload isn't working.
 *
 * @param autoReload - If true, automatically reload the page after cleanup (default: true)
 */
export async function clearServiceWorker(autoReload = true): Promise<void> {
  console.log("[Service Worker] Starting cleanup...");

  try {
    // Unregister all service workers
    await unregisterAllServiceWorkers();

    // Clear all caches
    await clearAllCaches();

    console.log("[Service Worker] Cleanup complete!");

    if (autoReload) {
      console.log("[Service Worker] Reloading page in 1 second...");
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  } catch (error) {
    console.error("[Service Worker] Cleanup failed:", error);
    throw error;
  }
}

/**
 * Show service worker status in console.
 * Useful for debugging service worker issues.
 */
export async function showServiceWorkerStatus(): Promise<void> {
  const status = await getServiceWorkerStatus();

  if (status.length === 0) {
    console.log("[Service Worker] No service workers registered");
    return;
  }

  console.log(`[Service Worker] Found ${status.length} service worker(s):`);
  console.table(status);
}
