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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftToLine, ArrowRightFromLine } from "lucide-react";
import { useNavigation, type NavItem as NavItemType, type NavSection } from "@/lib/navigation";
import { NvidiaLogo } from "./nvidia-logo";
import { cn, isMac } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
  useSidebar,
} from "@/components/shadcn/sidebar";

/**
 * Application sidebar using shadcn/ui Sidebar primitives.
 *
 * Features:
 * - Mobile-responsive Sheet behavior
 * - Keyboard shortcut (Cmd/Ctrl+B) to toggle
 * - Collapsible with icon-only mode
 * - Accessible and well-tested
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { state, isMobile } = useSidebar();
  // On mobile (hamburger overlay), always show expanded state regardless of desktop sidebar state
  const collapsed = isMobile ? false : state === "collapsed";

  // Get navigation from hook (server-driven when wired up)
  const { sections, isLoading } = useNavigation();

  const isItemActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-zinc-200 dark:border-zinc-800"
    >
      {/* Logo Header - matches original 56px (h-14) height */}
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-zinc-200 p-0 dark:border-zinc-800">
        <Link
          href="/"
          className={cn(
            "flex h-full items-center transition-all duration-200 ease-out",
            collapsed ? "justify-center px-2" : "gap-2 px-4",
          )}
        >
          <NvidiaLogo
            width={28}
            height={20}
            className="shrink-0"
          />
          <span
            className={cn(
              "overflow-hidden text-lg font-semibold tracking-tight whitespace-nowrap transition-all duration-200 ease-out",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
            )}
          >
            OSMO
          </span>
        </Link>
      </SidebarHeader>

      {/* Main Navigation */}
      <SidebarContent className="p-2">
        {isLoading ? (
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className={cn("space-y-1", collapsed && "items-center")}>
                {[1, 2, 3, 4].map((i) => (
                  <SidebarMenuSkeleton
                    key={i}
                    showIcon
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          sections.map((section, sectionIndex) => (
            <NavSectionGroup
              key={section.label ?? sectionIndex}
              section={section}
              sectionIndex={sectionIndex}
              isItemActive={isItemActive}
              collapsed={collapsed}
            />
          ))
        )}
      </SidebarContent>

      {/* Footer - collapse toggle */}
      <SidebarFooter className="border-t border-zinc-200 p-2 dark:border-zinc-800">
        <CollapseButton collapsed={collapsed} />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * Collapse toggle button - matches original styling
 */
function CollapseButton({ collapsed }: { collapsed: boolean }) {
  const { toggleSidebar } = useSidebar();
  const shortcutKey = isMac ? "⌘B" : "Ctrl+B";

  return (
    <SidebarMenu className={cn(collapsed && "items-center")}>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={toggleSidebar}
          tooltip={collapsed ? `Expand sidebar (${shortcutKey})` : undefined}
          className={cn(
            "rounded-lg py-2 text-sm font-medium text-zinc-600 transition-all duration-200 ease-out",
            "hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
            collapsed ? "!justify-center !gap-0 !px-2" : "gap-3 px-3",
          )}
        >
          {collapsed ? (
            <ArrowRightFromLine className="h-4 w-4 shrink-0" />
          ) : (
            <ArrowLeftToLine className="h-4 w-4 shrink-0" />
          )}
          <span
            className={cn(
              "flex-1 overflow-hidden whitespace-nowrap transition-all duration-200 ease-out",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
            )}
          >
            Collapse
          </span>
          {!collapsed && (
            <kbd className="pointer-events-none flex h-6 items-center gap-0.5 rounded border border-zinc-200 bg-zinc-100 px-1.5 font-mono text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
              {shortcutKey}
            </kbd>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * Navigation section group component
 */
function NavSectionGroup({
  section,
  sectionIndex,
  isItemActive,
  collapsed,
}: {
  section: NavSection;
  sectionIndex: number;
  isItemActive: (href: string) => boolean;
  collapsed: boolean;
}) {
  return (
    <>
      {/* Separator between sections */}
      {section.label && sectionIndex > 0 && <SidebarSeparator className="mx-0 my-2" />}

      <SidebarGroup className="p-0">
        {/* Section label - hidden when collapsed */}
        {section.label && (
          <SidebarGroupLabel
            className={cn(
              "h-auto px-3 py-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase transition-all duration-200 ease-out dark:text-zinc-400",
              "group-data-[collapsible=icon]:mt-0",
              collapsed && "h-0 py-0 opacity-0",
            )}
          >
            {section.label}
          </SidebarGroupLabel>
        )}

        <SidebarGroupContent>
          <SidebarMenu className={cn("space-y-1", collapsed && "items-center")}>
            {section.items.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                isActive={isItemActive(item.href)}
                collapsed={collapsed}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

/**
 * Individual navigation item - matches original styling
 */
function NavItem({ item, isActive, collapsed }: { item: NavItemType; isActive: boolean; collapsed: boolean }) {
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={item.name}
        className={cn(
          "rounded-lg py-2 text-sm font-medium transition-all duration-200 ease-out",
          collapsed ? "!justify-center !gap-0 !px-2" : "gap-3 px-3",
          isActive
            ? "bg-zinc-200 font-semibold text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
        )}
      >
        <Link href={item.href}>
          <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-[var(--nvidia-green)]")} />
          <span
            className={cn(
              "overflow-hidden whitespace-nowrap transition-all duration-200 ease-out",
              collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
            )}
          >
            {item.name}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
