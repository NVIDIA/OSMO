"use client";

import { X } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Node } from "@/lib/api/adapter";

interface NodePanelProps {
  node: Node | null;
  poolName: string;
  onClose: () => void;
}

export function NodePanel({ node, poolName, onClose }: NodePanelProps) {
  if (!node) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed bottom-0 right-0 top-0 z-50 w-full max-w-md overflow-y-auto border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <h2 className="text-lg font-semibold">{node.nodeName}</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {node.platform} · {poolName}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Resource Capacity */}
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Resource Capacity
            </h3>
            <div className="space-y-3">
              <ResourceBar label="GPU" used={node.gpu.used} total={node.gpu.total} />
              <ResourceBar label="CPU" used={node.cpu.used} total={node.cpu.total} />
              <ResourceBar label="Memory" used={node.memory.used} total={node.memory.total} unit="Gi" />
              <ResourceBar label="Storage" used={node.storage.used} total={node.storage.total} unit="Gi" />
            </div>
          </section>

          {/* Configuration */}
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Configuration
            </h3>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  Backend
                </span>
                <span className="text-sm font-medium">{node.backend}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  Hostname
                </span>
                <span className="text-sm font-medium">{node.hostname}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Run `osmo resource info {node.nodeName}` for full configuration
            </p>
          </section>

          {/* Resource type badge */}
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Resource Type
            </h3>
            <span
              className={cn(
                "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                node.resourceType === "RESERVED"
                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              )}
            >
              {node.resourceType}
            </span>
          </section>

          {/* Conditions if any */}
          {node.conditions.length > 0 && (
            <section>
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Conditions
              </h3>
              <div className="flex flex-wrap gap-2">
                {node.conditions.map((condition, idx) => (
                  <span
                    key={idx}
                    className="inline-flex rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  >
                    {condition}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function ResourceBar({
  label,
  used,
  total,
  unit = "",
}: {
  label: string;
  used: number;
  total: number;
  unit?: string;
}) {
  const percent = total > 0 ? (used / total) * 100 : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="font-medium tabular-nums">
          {formatNumber(used)}/{formatNumber(total)}
          {unit && <span className="ml-0.5 text-xs text-zinc-400">{unit}</span>}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            percent > 90
              ? "bg-red-500"
              : percent > 70
                ? "bg-amber-500"
                : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

