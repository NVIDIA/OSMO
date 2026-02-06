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

import { memo, Suspense } from "react";
import { AppSidebar } from "./app-sidebar";
import { Header } from "./header";
import { SIDEBAR_CSS_VARS } from "./constants";
import { Skeleton } from "@/components/shadcn/skeleton";
import { TableSkeleton } from "@/components/data-table/TableSkeleton";
import { SidebarInset, SidebarProvider } from "@/components/shadcn/sidebar";
import { useSharedPreferences, initialState as sharedPreferencesInitialState } from "@/stores/shared-preferences-store";
import { useMounted } from "@/hooks/use-mounted";

interface ChromeProps {
  children: React.ReactNode;
}

// PPR: Suspense allows static shell to prerender, dynamic content streams after hydration
export const Chrome = memo(function Chrome({ children }: ChromeProps) {
  const storeSidebarOpen = useSharedPreferences((s) => s.sidebarOpen);
  const setSidebarOpen = useSharedPreferences((s) => s.setSidebarOpen);

  // SSR-safe hydration: Use default value until after mount to prevent hydration mismatch.
  // Zustand persist returns initial state on server but localStorage value on client.
  const mounted = useMounted();

  // Use initial state during SSR/first render, then switch to store value after hydration
  const sidebarOpen = mounted ? storeSidebarOpen : sharedPreferencesInitialState.sidebarOpen;

  return (
    <Suspense fallback={<ChromeSkeleton>{children}</ChromeSkeleton>}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className="h-screen overflow-y-hidden"
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
        <SidebarInset className="flex flex-col overflow-y-hidden">
          {/* Header */}
          <Header />

          {/* Content - with optimized scrolling */}
          {/* Note: Pages are responsible for their own padding. This allows pages */}
          {/* with edge-to-edge layouts (like resizable panels) to use full space. */}
          <main
            id="main-content"
            tabIndex={-1}
            className="contain-layout-style scroll-optimized flex-1 overflow-auto overscroll-contain bg-zinc-50 dark:bg-zinc-900"
            aria-label="Main content"
          >
            <Suspense fallback={<MainContentSkeleton />}>{children}</Suspense>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </Suspense>
  );
});

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

function MainContentSkeleton() {
  return (
    <div className="animate-in fade-in flex h-full flex-col gap-4 duration-300">
      {/* Page header skeleton */}
      <div className="flex shrink-0 items-center justify-between p-6 pb-0">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      {/* Content skeleton */}
      <div className="mx-6 mb-6 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <TableSkeleton
          columnCount={5}
          rowCount={10}
          showHeader={true}
        />
      </div>
    </div>
  );
}
