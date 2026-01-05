// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { memo, Suspense } from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

interface ShellProps {
  children: React.ReactNode;
}

/**
 * Application shell with optimized layout.
 *
 * Performance optimizations:
 * - CSS containment for layout isolation
 * - GPU-accelerated transforms
 * - Suspense boundaries for async content
 * - Memoized to prevent unnecessary re-renders
 */
export const Shell = memo(function Shell({ children }: ShellProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-white contain-layout dark:bg-zinc-950">
      {/* Skip to main content link - WCAG 2.1 bypass block */}
      <a
        href="#main-content"
        className="focus:bg-nvidia sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-md focus:px-4 focus:py-2 focus:text-black focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Sidebar - isolated layout */}
      <Sidebar />

      {/* Main area - flex container with isolated layout */}
      <div className="flex flex-1 flex-col overflow-hidden contain-layout">
        {/* Header */}
        <Header />

        {/* Content - with optimized scrolling */}
        <main
          id="main-content"
          tabIndex={-1}
          className="scroll-optimized flex-1 overflow-auto overscroll-contain bg-zinc-50 p-6 dark:bg-zinc-900"
          aria-label="Main content"
        >
          <Suspense fallback={<MainContentSkeleton />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
});

/**
 * Skeleton for main content area - prevents CLS during page transitions.
 */
function MainContentSkeleton() {
  return (
    <div className="animate-in fade-in flex h-full flex-col gap-6 duration-300">
      {/* Page header skeleton */}
      <div className="shrink-0 space-y-2">
        <div className="skeleton-shimmer h-8 w-48 rounded" />
        <div className="skeleton-shimmer h-4 w-72 rounded" />
      </div>

      {/* Content skeleton */}
      <div className="flex-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4"
            >
              <div className="skeleton-shimmer h-10 flex-1 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
