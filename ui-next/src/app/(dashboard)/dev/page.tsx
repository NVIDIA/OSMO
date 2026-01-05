// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import Link from "next/link";
import { FlaskConical, Workflow } from "lucide-react";
import { usePage } from "@/components/shell";

/**
 * Development Pages Index
 *
 * This page lists all development/experimental pages.
 * These pages are for design exploration, prototyping, and testing.
 * They should NOT be included in production builds.
 *
 * To remove all dev pages from production:
 * 1. Delete this entire /dev directory
 * 2. Or use next.config.ts to exclude /dev routes
 */

const devPages = [
  {
    title: "Workflow Explorer",
    href: "/dev/workflow-explorer",
    description: "Compare different DAG and timeline visualization approaches",
    icon: Workflow,
    highlight: true,
  },
];

export default function DevIndexPage() {
  usePage({ title: "Dev" });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-3">
        <div className="rounded-lg bg-purple-500/10 p-2">
          <FlaskConical className="h-6 w-6 text-purple-400" />
        </div>
        <p className="text-muted-foreground text-sm">Design exploration, prototypes, and experimental features</p>
      </div>

      {/* Warning */}
      <div className="mb-8 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <p className="text-sm text-amber-200">
          <strong>Note:</strong> These pages are for development only and use mock data. They should be removed or
          hidden in production.
        </p>
      </div>

      {/* Page Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {devPages.map((page) => (
          <Link
            key={page.href}
            href={page.href}
            className={`group rounded-lg border p-4 transition-all ${
              "highlight" in page && page.highlight
                ? "border-cyan-500/50 bg-cyan-500/5 hover:border-cyan-400 hover:bg-cyan-500/10"
                : "border-border bg-card hover:border-primary/50 hover:bg-accent/50"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`rounded-lg p-2 transition-colors ${
                  "highlight" in page && page.highlight
                    ? "bg-cyan-500/10 group-hover:bg-cyan-500/20"
                    : "bg-muted group-hover:bg-primary/10"
                }`}
              >
                <page.icon
                  className={`h-5 w-5 transition-colors ${
                    "highlight" in page && page.highlight
                      ? "text-cyan-400 group-hover:text-cyan-300"
                      : "text-muted-foreground group-hover:text-primary"
                  }`}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    className={`font-semibold transition-colors ${
                      "highlight" in page && page.highlight
                        ? "text-cyan-400 group-hover:text-cyan-300"
                        : "text-foreground group-hover:text-primary"
                    }`}
                  >
                    {page.title}
                  </h2>
                  {"highlight" in page && page.highlight && (
                    <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400">
                      NEW
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mt-1 text-sm">{page.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer */}
      <div className="border-border mt-12 border-t pt-8">
        <h3 className="text-muted-foreground mb-2 text-sm font-medium">Adding New Dev Pages</h3>
        <p className="text-muted-foreground text-sm">
          Create a new folder under <code className="bg-muted rounded px-1 py-0.5">/dev</code> and add it to the{" "}
          <code className="bg-muted rounded px-1 py-0.5">devPages</code> array in this file.
        </p>
      </div>
    </div>
  );
}
