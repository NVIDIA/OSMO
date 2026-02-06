"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { useMounted } from "@/hooks/use-mounted";

/**
 * Theme toggle with GPU-accelerated transitions.
 *
 * Performance: Uses transform (rotate, scale) and opacity only -
 * no layout-triggering properties. GPU composited.
 *
 * Note: Wrapped with useMounted to prevent hydration mismatch from
 * Radix UI's DropdownMenu generating different IDs on server vs client.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();
  const mounted = useMounted();

  // Render placeholder during SSR to prevent hydration mismatch
  // from Radix UI's ID generation
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        disabled
      >
        <Sun className="h-4 w-4" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
        >
          {/* Sun icon - visible in light mode, hidden in dark */}
          <Sun className="h-4 w-4 transition-[transform,opacity] duration-200 dark:scale-75 dark:rotate-90 dark:opacity-0" />
          {/* Moon icon - hidden in light mode, visible in dark */}
          <Moon className="absolute h-4 w-4 scale-75 rotate-90 opacity-0 transition-[transform,opacity] duration-200 dark:scale-100 dark:rotate-0 dark:opacity-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
