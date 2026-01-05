"use client";

import { useState, memo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeftToLine, ArrowRightFromLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useNavigation, type NavItem as NavItemType } from "@/lib/navigation";
import { NvidiaLogo } from "./nvidia-logo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";

interface NavItemProps {
  item: NavItemType;
  isActive: boolean;
  collapsed: boolean;
}

/**
 * Memoized navigation item.
 * Only re-renders when isActive or collapsed state changes.
 */
const NavItem = memo(function NavItem({ item, isActive, collapsed }: NavItemProps) {
  const Icon = item.icon;

  const linkContent = (
    <Link
      href={item.href}
      className={cn(
        "flex items-center rounded-lg py-2 text-sm font-medium transition-all duration-200 ease-out",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        isActive
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={cn(
          "transition-all duration-200 ease-out overflow-hidden whitespace-nowrap",
          collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
        )}
      >
        {item.name}
      </span>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block">{linkContent}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{item.name}</TooltipContent>
      </Tooltip>
    );
  }

  return linkContent;
});

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  // Get navigation from hook (server-driven when wired up)
  const { sections, isLoading } = useNavigation();

  // Track if we've done initial load - only show skeleton on first render
  const [hasLoaded, setHasLoaded] = useState(false);
  if (!isLoading && !hasLoaded) {
    setHasLoaded(true);
  }
  const showSkeleton = isLoading && !hasLoaded;

  const isItemActive = (href: string) => pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <TooltipProvider delayDuration={0}>
      {/* Sidebar */}
      <aside
        id="sidebar-nav"
        className={cn(
          "flex h-full flex-col border-r border-zinc-200 bg-zinc-50 transition-[width] duration-200 ease-out dark:border-zinc-800 dark:bg-zinc-950",
          collapsed ? "w-[52px]" : "w-48",
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-zinc-200 transition-all duration-200 ease-out dark:border-zinc-800",
            collapsed ? "justify-center px-2" : "px-3",
          )}
        >
          <Link
            href="/"
            className={cn(
              "flex items-center transition-all duration-200 ease-out",
              collapsed ? "justify-center" : "gap-2",
            )}
          >
            <NvidiaLogo
              width={28}
              height={20}
              className="shrink-0"
            />
            <span
              className={cn(
                "text-lg font-semibold tracking-tight transition-all duration-200 ease-out overflow-hidden whitespace-nowrap",
                collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
              )}
            >
              OSMO
            </span>
          </Link>
        </div>

        {/* Main navigation - rendered by section */}
        <nav className="flex-1 space-y-1 p-2">
          {showSkeleton ? (
            // Skeleton loader - only on initial load
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={cn(
                    "h-9 animate-pulse rounded-lg bg-zinc-200 transition-all duration-200 ease-out dark:bg-zinc-800",
                    collapsed ? "w-9 mx-auto" : "",
                  )}
                />
              ))}
            </div>
          ) : (
            sections.map((section, sectionIndex) => (
              <div
                key={section.label ?? sectionIndex}
                className="space-y-1"
              >
                {/* Section separator for labeled sections */}
                {section.label && sectionIndex > 0 && (
                  <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
                )}
                {/* Section label (only shown when expanded and has label) */}
                {section.label && (
                  <div
                    className={cn(
                      "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-all duration-200 ease-out overflow-hidden whitespace-nowrap dark:text-zinc-400",
                      collapsed ? "h-0 py-0 opacity-0" : "h-auto opacity-100",
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

        {/* Bottom section - collapse toggle */}
        <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!collapsed}
                aria-controls="sidebar-nav"
                className={cn(
                  "flex w-full items-center rounded-lg py-2 text-sm font-medium transition-all duration-200 ease-out text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                  collapsed ? "justify-center px-2" : "gap-3 px-3",
                )}
              >
                {collapsed ? (
                  <ArrowRightFromLine className="h-4 w-4 shrink-0" />
                ) : (
                  <ArrowLeftToLine className="h-4 w-4 shrink-0" />
                )}
                <span
                  className={cn(
                    "transition-all duration-200 ease-out overflow-hidden whitespace-nowrap",
                    collapsed ? "w-0 opacity-0" : "w-auto opacity-100",
                  )}
                >
                  Collapse
                </span>
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Expand sidebar</TooltipContent>}
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
