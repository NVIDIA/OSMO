"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useNavigation } from "@/lib/use-navigation";
import type { NavItem } from "@/lib/navigation";
import { NvidiaLogo } from "@/components/nvidia-logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItemProps {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
}

function NavItemLink({ item, isActive, collapsed }: NavItemProps) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center rounded-lg py-2 text-sm font-medium transition-all duration-200 ease-out",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        isActive
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={cn(
          "transition-all duration-200 ease-out overflow-hidden whitespace-nowrap",
          collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
        )}
      >
        {item.name}
      </span>
    </Link>
  );
}

function NavItem({ item, isActive, collapsed }: NavItemProps) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavItemLink item={item} isActive={isActive} collapsed={collapsed} />
        </TooltipTrigger>
        <TooltipContent side="right">{item.name}</TooltipContent>
      </Tooltip>
    );
  }

  return <NavItemLink item={item} isActive={isActive} collapsed={collapsed} />;
}

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  // Get navigation from hook (server-driven when wired up)
  const { sections, bottomItems, isLoading } = useNavigation();

  const isItemActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <TooltipProvider delayDuration={0}>
      {/* Wrapper for sidebar + toggle button */}
      <div className="group relative flex h-full">
        {/* Sidebar */}
        <aside
          id="sidebar-nav"
          className={cn(
            "flex h-full flex-col border-r border-zinc-200 bg-zinc-50 transition-[width] duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950",
            collapsed ? "w-[52px]" : "w-48"
          )}
        >
          {/* Logo */}
          <div
            className={cn(
              "flex h-14 shrink-0 items-center border-b border-zinc-200 transition-all duration-200 ease-out dark:border-zinc-800",
              collapsed ? "justify-center px-2" : "px-3"
            )}
          >
            <Link
              href="/"
              className={cn(
                "flex items-center transition-all duration-200 ease-out",
                collapsed ? "justify-center" : "gap-2"
              )}
            >
              <NvidiaLogo width={28} height={20} className="shrink-0" />
              <span
                className={cn(
                  "text-lg font-semibold tracking-tight transition-all duration-200 ease-out overflow-hidden whitespace-nowrap",
                  collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                )}
              >
                OSMO
              </span>
            </Link>
          </div>

          {/* Main navigation - rendered by section */}
          <nav className="flex-1 space-y-1 p-2">
            {isLoading ? (
              // Skeleton loader
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-9 animate-pulse rounded-lg bg-zinc-200 transition-all duration-200 ease-out dark:bg-zinc-800",
                      collapsed ? "w-9 mx-auto" : ""
                    )}
                  />
                ))}
              </div>
            ) : (
              sections.map((section, sectionIndex) => (
                <div key={section.label ?? sectionIndex} className="space-y-1">
                  {/* Section separator for labeled sections */}
                  {section.label && sectionIndex > 0 && (
                    <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
                  )}
                  {/* Section label (only shown when expanded and has label) */}
                  {section.label && (
                    <div
                      className={cn(
                        "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-all duration-200 ease-out overflow-hidden whitespace-nowrap dark:text-zinc-400",
                        collapsed ? "h-0 py-0 opacity-0" : "h-auto opacity-100"
                      )}
                    >
                      {section.label}
                    </div>
                  )}
                  {section.items.map((item) => (
                    <NavItem
                      key={item.href}
                      item={item}
                      isActive={isItemActive(item.href)}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              ))
            )}
          </nav>

          {/* Bottom section */}
          <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
            {bottomItems.map((item) => (
              <NavItem
                key={item.href}
                item={item}
                isActive={isItemActive(item.href)}
                collapsed={collapsed}
              />
            ))}
          </div>
        </aside>

        {/* Collapse/expand button - outside aside, won't be clipped */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              aria-controls="sidebar-nav"
              className="absolute -right-3 top-1/2 z-10 h-6 w-6 -translate-y-1/2 rounded-full border border-zinc-300 bg-white opacity-0 shadow-sm transition-opacity hover:bg-zinc-100 focus:opacity-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              {collapsed ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronLeft className="h-3 w-3" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
