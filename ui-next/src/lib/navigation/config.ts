/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { LayoutDashboard, Workflow, Layers, Server, Logs, Settings, Shield, Key, type LucideIcon } from "lucide-react";

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
  { name: "Log Viewer", href: "/log-viewer", icon: Logs },
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
