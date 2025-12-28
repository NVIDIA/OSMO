// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Status Utilities
 *
 * Helper functions for status categorization and icons.
 */

import { Clock, Loader2, CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_STYLES, type StatusCategory } from "../constants";
import {
  getStatusCategory as getStatusCategoryFromTypes,
  isFailedStatus as isFailedStatusFromTypes,
} from "../../workflow-types";

// Re-export the status category and failure check functions
export const getStatusCategory = getStatusCategoryFromTypes;
export const isFailedStatus = isFailedStatusFromTypes;

/**
 * Get the appropriate status icon for a given status.
 *
 * @param status - The status string from the backend
 * @param size - Tailwind size classes (default "h-4 w-4")
 * @returns JSX element for the status icon
 */
export function getStatusIcon(status: string, size = "h-4 w-4") {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return (
        <Clock
          className={cn(size, "text-zinc-400")}
          aria-hidden="true"
        />
      );
    case "running":
      return (
        <Loader2
          className={cn(size, "text-blue-400 animate-spin motion-reduce:animate-none")}
          aria-hidden="true"
        />
      );
    case "completed":
      return (
        <CheckCircle
          className={cn(size, "text-emerald-400")}
          aria-hidden="true"
        />
      );
    case "failed":
      return (
        <XCircle
          className={cn(size, "text-red-400")}
          aria-hidden="true"
        />
      );
  }
}

/**
 * Get styling for a status category.
 *
 * @param status - The status string from the backend
 * @returns Status styling object
 */
export function getStatusStyle(status: string) {
  const category = getStatusCategory(status);
  return STATUS_STYLES[category as StatusCategory];
}

/**
 * Get edge color for a status category.
 *
 * @param category - The status category
 * @returns Hex color string
 */
export function getEdgeColor(category: StatusCategory): string {
  return STATUS_STYLES[category].color;
}

/**
 * Get accessible status label.
 *
 * @param status - The status string from the backend
 * @returns Human-readable status label
 */
export function getStatusLabel(status: string): string {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return "Waiting";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
  }
}
