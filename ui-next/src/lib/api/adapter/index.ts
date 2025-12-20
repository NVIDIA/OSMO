/**
 * Backend Adapter Layer
 *
 * This module provides clean, ideal types and hooks for the UI.
 * All backend workarounds are contained in transforms.ts.
 *
 * Usage:
 * ```typescript
 * import { usePools, usePool, usePoolResources, useVersion } from "@/lib/api/adapter";
 * import type { Pool, Node, Version } from "@/lib/api/adapter";
 * ```
 */

// Ideal types
export type {
  Pool,
  PoolsResponse,
  PoolStatus,
  Quota,
  PlatformConfig,
  Node,
  PoolResourcesResponse,
  ResourceType,
  ResourceCapacity,
  PoolMembership,
  TaskConfig,
  Version,
} from "./types";

// Clean hooks
export {
  usePools,
  usePool,
  usePoolResources,
  useVersion,
  useResourceInfo,
} from "./hooks";
