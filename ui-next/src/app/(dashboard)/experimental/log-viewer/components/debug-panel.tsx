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

import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/card";
import { Activity } from "lucide-react";

/**
 * Debug statistics for the log viewer.
 */
export interface DebugStats {
  /** Number of log entries currently in memory */
  entriesInMemory: number;
  /** Last render time in milliseconds */
  renderTimeMs: number;
  /** Index size in kilobytes */
  indexSizeKb: number;
  /** Last update timestamp */
  lastUpdate: Date | null;
}

interface DebugPanelProps {
  stats: DebugStats;
}

/**
 * Debug panel showing performance and memory statistics.
 * Useful for monitoring log viewer performance during development.
 */
export function DebugPanel({ stats }: DebugPanelProps) {
  const formatNumber = (n: number) => n.toLocaleString();
  const formatTime = (date: Date | null) => {
    if (!date) return "Never";
    return date.toLocaleTimeString();
  };

  return (
    <Card className="border-border/50 bg-card/95 w-64 shadow-lg backdrop-blur-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-purple-400" />
          Debug Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <StatRow
          label="Entries in memory"
          value={formatNumber(stats.entriesInMemory)}
        />
        <StatRow
          label="Render time"
          value={`${stats.renderTimeMs.toFixed(1)}ms`}
        />
        <StatRow
          label="Index size"
          value={`${stats.indexSizeKb.toFixed(1)}KB`}
        />
        <StatRow
          label="Last update"
          value={formatTime(stats.lastUpdate)}
        />
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono">{value}</span>
    </div>
  );
}
