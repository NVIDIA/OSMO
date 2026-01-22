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

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/shadcn/sonner";

// Optimized font loading with display: swap for faster FCP
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap", // Prevents FOIT (Flash of Invisible Text)
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Use 'swap' for mono font - essential for terminal/code rendering
  display: "swap",
  // Don't preload - mono font is primarily used in specific components (terminals, logs)
  // that aren't immediately visible on all pages. This eliminates preload warnings
  // while maintaining fast loading when needed via font-display: swap.
  preload: false,
});

export const metadata: Metadata = {
  title: "OSMO",
  description: "OSMO Platform",
  // Performance hints for browsers
  other: {
    "x-dns-prefetch-control": "on",
  },
};

// Viewport configuration for optimal mobile performance
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Prevent zoom on input focus (iOS)
  maximumScale: 1,
  userScalable: false,
  // Theme color for browser chrome
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

/**
 * Minimal loading fallback for initial app load.
 * Shown briefly while client providers hydrate.
 * Uses inline styles to avoid CSS loading delay.
 */
function AppLoadingFallback() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        backgroundColor: "#09090b", // zinc-950
      }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          border: "3px solid #27272a", // zinc-800
          borderTopColor: "#76b900", // NVIDIA green
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // Prevent layout shift during theme hydration
      className="scroll-smooth"
      data-scroll-behavior="smooth"
    >
      <head>
        {/* Preconnect for faster resource loading */}
        {/* Fonts - preconnect reduces connection setup time by ~100-200ms */}
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* DNS prefetch as fallback for browsers that don't support preconnect */}
        <link
          rel="dns-prefetch"
          href="//fonts.googleapis.com"
        />
        <link
          rel="dns-prefetch"
          href="//fonts.gstatic.com"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        // Prevent text size adjustment on orientation change
        style={{
          textSizeAdjust: "100%",
          WebkitTextSizeAdjust: "100%",
        }}
      >
        {/* Suspense boundary required for cacheComponents (Next.js 16) */}
        {/* Client providers use useState which needs Suspense for prerendering */}
        <Suspense fallback={<AppLoadingFallback />}>
          <Providers>{children}</Providers>
        </Suspense>
        <Toaster
          richColors
          position="bottom-right"
        />
      </body>
    </html>
  );
}
