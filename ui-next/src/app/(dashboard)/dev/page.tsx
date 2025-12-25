// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import Link from "next/link";
import { FlaskConical, GitBranch, HelpCircle, LayoutList, Palette } from "lucide-react";

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
    title: "Workflows Mock",
    href: "/dev/workflows-mock",
    description: "Workflow list design exploration with mock data",
    icon: LayoutList,
  },
  {
    title: "DAG Visualization",
    href: "/dev/workflows-mock/dag",
    description: "DAG/graph visualization for workflow tasks",
    icon: GitBranch,
  },
  {
    title: "Status Explainers",
    href: "/dev/workflows-mock/explain",
    description: '"Why isn\'t it running?" and failure explanation UIs',
    icon: HelpCircle,
  },
  {
    title: "Vertical DAG",
    href: "/dev/dag-vertical",
    description: "Vertical top-to-bottom DAG with timeline view",
    icon: GitBranch,
  },
];

export default function DevIndexPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 rounded-lg bg-purple-500/10">
          <FlaskConical className="h-6 w-6 text-purple-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Development Pages</h1>
          <p className="text-sm text-muted-foreground">Design exploration, prototypes, and experimental features</p>
        </div>
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
            className="group p-4 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/50 transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-muted group-hover:bg-primary/10 transition-colors">
                <page.icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                  {page.title}
                </h2>
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
