"use client";

import Link from "next/link";
import { Search, Command, LogIn } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { useUser } from "@/lib/user-context";
import { useVersion } from "@/lib/api/adapter";

export function Header() {
  const { isAuthenticated, isSkipped, login, logout } = useAuth();
  const { user, isLoading } = useUser();
  const { version } = useVersion();

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Left: Breadcrumbs placeholder */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-500">Dashboard</span>
      </div>

      {/* Right: Search, Theme, User */}
      <div className="flex items-center gap-2">
        {/* Command palette trigger */}
        <Button
          variant="outline"
          size="sm"
          className="hidden h-8 w-64 justify-start gap-2 text-zinc-500 md:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left text-sm">Search...</span>
          <kbd className="pointer-events-none flex h-5 items-center gap-1 rounded border border-zinc-200 bg-zinc-100 px-1.5 font-mono text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
            <Command className="h-3 w-3" />K
          </kbd>
        </Button>

        {/* Mobile search button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
        >
          <Search className="h-4 w-4" />
          <span className="sr-only">Search</span>
        </Button>

        <ThemeToggle />

        {/* User menu or Login button */}
        {isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nvidia-green)] text-sm font-medium text-black">
                  {user.initials}
                </div>
                <span className="sr-only">User menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
            >
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-zinc-500">{user.email}</p>
                {user.isAdmin && (
                  <span className="mt-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                    Admin
                  </span>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">Profile Settings</Link>
              </DropdownMenuItem>
              {version && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      OSMO {version.major}.{version.minor}.{version.revision}
                      {version.hash && ` (${version.hash.slice(0, 7)})`}
                    </p>
                  </div>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-red-600 dark:text-red-400"
                onClick={() => logout()}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : isLoading ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800">
            <span className="h-4 w-4 animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </div>
        ) : isSkipped ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={login}
            className="gap-1.5 text-zinc-500"
          >
            <LogIn className="h-4 w-4" />
            <span className="hidden sm:inline">Log in</span>
          </Button>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-500 dark:bg-zinc-800">
            ?
          </div>
        )}
      </div>
    </header>
  );
}
