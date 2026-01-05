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
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 rounded-lg bg-purple-500/10">
          <FlaskConical className="h-6 w-6 text-purple-400" />
        </div>
        <p className="text-sm text-muted-foreground">Design exploration, prototypes, and experimental features</p>
      </div>

      {/* Warning */}
      <div className="mb-8 p-4 rounded-lg border border-amber-500/30 bg-amber-500/5">
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
            className={`group p-4 rounded-lg border transition-all ${
              "highlight" in page && page.highlight
                ? "border-cyan-500/50 bg-cyan-500/5 hover:border-cyan-400 hover:bg-cyan-500/10"
                : "border-border bg-card hover:border-primary/50 hover:bg-accent/50"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-lg transition-colors ${
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
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-medium">
                      NEW
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{page.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer */}
      <div className="mt-12 pt-8 border-t border-border">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Adding New Dev Pages</h3>
        <p className="text-sm text-muted-foreground">
          Create a new folder under <code className="bg-muted px-1 py-0.5 rounded">/dev</code> and add it to the{" "}
          <code className="bg-muted px-1 py-0.5 rounded">devPages</code> array in this file.
        </p>
      </div>
    </div>
  );
}
