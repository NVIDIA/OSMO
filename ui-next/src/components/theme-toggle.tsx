"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Theme toggle with GPU-accelerated transitions.
 *
 * Performance: Uses transform (rotate, scale) and opacity only -
 * no layout-triggering properties. GPU composited.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
        >
          {/* Sun icon - visible in light mode, hidden in dark */}
          <Sun className="h-4 w-4 transition-[transform,opacity] duration-200 dark:opacity-0 dark:rotate-90 dark:scale-75" />
          {/* Moon icon - hidden in light mode, visible in dark */}
          <Moon className="absolute h-4 w-4 opacity-0 rotate-90 scale-75 transition-[transform,opacity] duration-200 dark:opacity-100 dark:rotate-0 dark:scale-100" />
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
