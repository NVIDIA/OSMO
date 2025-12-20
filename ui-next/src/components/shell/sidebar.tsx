"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Workflow,
  Layers,
  Server,
  User,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { NvidiaLogo } from "@/components/nvidia-logo";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Workflows", href: "/workflows", icon: Workflow },
  { name: "Pools", href: "/pools", icon: Layers },
  { name: "Resources", href: "/resources", icon: Server },
];

const bottomNavigation = [
  { name: "Profile", href: "/profile", icon: User },
];

interface NavItemProps {
  name: string;
  href: string;
  icon: LucideIcon;
  isActive: boolean;
  collapsed: boolean;
}

function NavItem({ name, href, icon: Icon, isActive, collapsed }: NavItemProps) {
  const linkContent = (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span
        className={cn(
          "whitespace-nowrap transition-opacity duration-200",
          collapsed ? "opacity-0" : "opacity-100"
        )}
      >
        {name}
      </span>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right">{name}</TooltipContent>
      </Tooltip>
    );
  }

  return linkContent;
}

export function Sidebar() {
  const pathname = usePathname();
  const { collapsed, toggle } = useSidebar();

  return (
    <TooltipProvider delayDuration={0}>
      {/* Wrapper for sidebar + toggle button */}
      <div className="group relative flex h-full">
        {/* Sidebar */}
        <aside
          id="sidebar-nav"
          className={cn(
            "flex h-full flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50 transition-all duration-200 ease-in-out dark:border-zinc-800 dark:bg-zinc-950",
            collapsed ? "w-14" : "w-48"
          )}
        >
          {/* Logo */}
          <div className="flex h-14 shrink-0 items-center border-b border-zinc-200 px-3 dark:border-zinc-800">
            <Link href="/" className="flex items-center gap-2">
              <NvidiaLogo width={28} height={20} className="shrink-0" />
              <span
                className={cn(
                  "whitespace-nowrap text-lg font-semibold tracking-tight transition-opacity duration-200",
                  collapsed ? "opacity-0" : "opacity-100"
                )}
              >
                OSMO
              </span>
            </Link>
          </div>

          {/* Main navigation */}
          <nav className="flex-1 space-y-1 p-2">
            {navigation.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              return (
                <NavItem
                  key={item.name}
                  name={item.name}
                  href={item.href}
                  icon={item.icon}
                  isActive={isActive}
                  collapsed={collapsed}
                />
              );
            })}
          </nav>

          {/* Bottom section */}
          <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
            {bottomNavigation.map((item) => {
              const isActive = pathname === item.href;

              return (
                <NavItem
                  key={item.name}
                  name={item.name}
                  href={item.href}
                  icon={item.icon}
                  isActive={isActive}
                  collapsed={collapsed}
                />
              );
            })}
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
