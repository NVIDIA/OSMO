/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { LayoutDashboard, Workflow, Layers, Server, Settings, Shield, Key, type LucideIcon } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

// =============================================================================
// Static Navigation Data
// =============================================================================

/** User-facing navigation - always visible */
const userNav: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Workflows", href: "/workflows", icon: Workflow },
  { name: "Pools", href: "/pools", icon: Layers },
  { name: "Resources", href: "/resources", icon: Server },
];

/** Bottom navigation - empty now (profile is in top-right header) */
const bottomNav: NavItem[] = [];

/** Admin-facing navigation - conditionally included */
const adminSection: NavSection = {
  label: "Admin",
  items: [
    { name: "Settings", href: "/admin/settings", icon: Settings },
    { name: "Roles", href: "/admin/roles", icon: Shield },
    { name: "API Tokens", href: "/admin/tokens", icon: Key },
  ],
};

// =============================================================================
// Build Navigation
// =============================================================================

export interface Navigation {
  sections: NavSection[];
  bottomItems: NavItem[];
}

/**
 * Build the full navigation structure.
 *
 * @param isAdmin - Whether to include admin section
 */
export function buildNavigation(isAdmin: boolean): Navigation {
  const sections: NavSection[] = [{ items: userNav }];

  if (isAdmin) {
    sections.push(adminSection);
  }

  return {
    sections,
    bottomItems: bottomNav,
  };
}
