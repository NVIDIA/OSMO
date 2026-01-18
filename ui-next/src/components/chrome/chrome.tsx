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

import { memo, Suspense } from "react";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";
import { SIDEBAR_CSS_VARS } from "./constants";
import { Skeleton } from "@/components/shadcn/skeleton";
import { Card } from "@/components/shadcn/card";
import { SidebarInset, SidebarProvider } from "@/components/shadcn/sidebar";

interface ChromeProps {
  children: React.ReactNode;
}

/**
 * Application chrome with optimized layout.
 *
 * Uses shadcn/ui Sidebar for:
 * - Mobile-responsive Sheet behavior
 * - Keyboard shortcut (Cmd/Ctrl+B) to toggle
 * - Collapsible with icon-only mode
 * - Accessibility out of the box
 *
 * PPR Compatibility:
 * - SidebarProvider, AppSidebar, and Header are wrapped in Suspense
 * - This allows the static shell structure to be prerendered at build time
 * - Dynamic content (sidebar state, nav highlighting) streams in after hydration
 */
export const Chrome = memo(function Chrome({ children }: ChromeProps) {
  return (
    <Suspense fallback={<ChromeSkeleton>{children}</ChromeSkeleton>}>
      <SidebarProvider
        defaultOpen={true}
        className="h-screen overflow-hidden"
        style={SIDEBAR_CSS_VARS as React.CSSProperties}
      >
        {/* Skip to main content link - WCAG 2.1 bypass block */}
        <a
          href="#main-content"
          className="focus:bg-nvidia sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:m-2 focus:rounded-md focus:px-4 focus:py-2 focus:text-black focus:outline-none"
        >
          Skip to main content
        </a>

        {/* Sidebar */}
        <AppSidebar />

        {/* Main area - flex to fill remaining space */}
        <SidebarInset className="flex flex-col overflow-hidden">
          {/* Header */}
          <Header />

          {/* Content - with optimized scrolling */}
          {/* Note: Pages are responsible for their own padding. This allows pages */}
          {/* with edge-to-edge layouts (like resizable panels) to use full space. */}
          <main
            id="main-content"
            tabIndex={-1}
            className="scroll-optimized flex-1 overflow-auto overscroll-contain bg-zinc-50 dark:bg-zinc-900"
            aria-label="Main content"
          >
            <Suspense fallback={<MainContentSkeleton />}>{children}</Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </Suspense>
  );
});

/**
 * Chrome skeleton for PPR - matches the Chrome layout structure.
 *
 * This is shown during prerender/streaming while the Chrome components hydrate.
 * Children are rendered immediately so page content isn't blocked.
 *
 * IMPORTANT: We wrap children in SidebarProvider so components using useSidebar()
 * don't crash during the skeleton phase. The provider uses defaultOpen=true to match
 * the skeleton's visual layout (showing expanded sidebar).
 */
function ChromeSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      defaultOpen={true}
      className="flex h-screen w-full overflow-hidden"
      style={SIDEBAR_CSS_VARS as React.CSSProperties}
    >
      {/* Sidebar skeleton - matches expanded sidebar width */}
      <div className="hidden h-full w-64 shrink-0 border-r border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-950">
        {/* Logo header skeleton */}
        <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Skeleton className="h-5 w-7" />
          <Skeleton className="h-5 w-16" />
        </div>
        {/* Nav items skeleton */}
        <div className="space-y-2 p-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton
              key={i}
              className="h-9 w-full rounded-lg"
            />
          ))}
        </div>
      </div>

      {/* Main area skeleton */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header skeleton */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>

        {/* Content area - render children immediately */}
        <main
          id="main-content"
          tabIndex={-1}
          className="scroll-optimized flex-1 overflow-auto overscroll-contain bg-zinc-50 dark:bg-zinc-900"
          aria-label="Main content"
        >
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}

/**
 * Skeleton for main content area - prevents CLS during page transitions.
 */
function MainContentSkeleton() {
  return (
    <div className="animate-in fade-in flex h-full flex-col gap-6 p-6 duration-300">
      {/* Page header skeleton */}
      <div className="shrink-0 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Content skeleton */}
      <Card className="flex-1 p-4">
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4"
            >
              <Skeleton className="h-10 flex-1" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
