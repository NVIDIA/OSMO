import {
  LayoutDashboard,
  Workflow,
  Layers,
  User,
  Settings,
  Shield,
  Key,
  type LucideIcon,
} from "lucide-react";

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
];

/** Bottom navigation - always visible */
const bottomNav: NavItem[] = [
  { name: "Profile", href: "/profile", icon: User },
];

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
  const sections: NavSection[] = [
    { items: userNav },
  ];

  if (isAdmin) {
    sections.push(adminSection);
  }

  return {
    sections,
    bottomItems: bottomNav,
  };
}
