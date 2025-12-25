// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

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
  display: "swap",
  preload: true,
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
    >
      <head>
        {/* Preconnect to API for faster data fetching */}
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
        <Providers>{children}</Providers>
        <Toaster
          richColors
          position="bottom-right"
        />
      </body>
    </html>
  );
}
