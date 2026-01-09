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

import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { usePage } from "@/components/shell";

/**
 * Development Pages Index
 *
 * This page lists all development/experimental pages.
 * These pages are for design exploration, prototyping, and testing.
 *
 * Tree-shaken in production via NODE_ENV check below.
 */

// Redirect away in production - this check is evaluated at build time
// allowing the bundler to tree-shake the entire dev page in prod builds
if (process.env.NODE_ENV === "production") {
  redirect("/");
}

interface DevPage {
  title: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const devPages: DevPage[] = [
  // Add dev pages here as needed:
  // {
  //   title: "Example Page",
  //   href: "/dev/example",
  //   description: "Description of the experimental feature",
  //   icon: SomeIcon,
  // },
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
          <strong>Note:</strong> These pages are for development only and use mock data. This page is not accessible in
          production.
        </p>
      </div>

      {/* Page Grid */}
      {devPages.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {devPages.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="border-border bg-card hover:border-primary/50 hover:bg-accent/50 group rounded-lg border p-4 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="bg-muted group-hover:bg-primary/10 rounded-lg p-2 transition-colors">
                  <page.icon className="text-muted-foreground group-hover:text-primary h-5 w-5 transition-colors" />
                </div>
                <div>
                  <h2 className="text-foreground group-hover:text-primary font-semibold transition-colors">
                    {page.title}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">{page.description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="border-border bg-card/50 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">No dev pages currently. Add pages to the devPages array.</p>
        </div>
      )}

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
