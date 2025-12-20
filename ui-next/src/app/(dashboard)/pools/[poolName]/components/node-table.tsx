"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { NodePanel } from "../../components/node-panel";
import type { Node } from "@/lib/api/adapter";

interface NodeTableProps {
  nodes: Node[];
  isLoading?: boolean;
  poolName: string;
}

export function NodeTable({ nodes, isLoading, poolName }: NodeTableProps) {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No nodes found
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="grid grid-cols-[1fr_120px_80px_80px_80px_80px] gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <div>Node</div>
          <div>Platform</div>
          <div className="text-right">GPU</div>
          <div className="text-right">CPU</div>
          <div className="text-right">Memory</div>
          <div className="text-right">Storage</div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {nodes.map((node, idx) => (
            <button
              key={`${node.nodeName}-${node.platform}-${idx}`}
              onClick={() => setSelectedNode(node)}
              className="grid w-full grid-cols-[1fr_120px_80px_80px_80px_80px] gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {node.nodeName}
              </div>
              <div className="text-zinc-500 dark:text-zinc-400">
                {node.platform}
              </div>
              <ResourceCell used={node.gpu.used} total={node.gpu.total} />
              <ResourceCell used={node.cpu.used} total={node.cpu.total} />
              <ResourceCell used={node.memory.used} total={node.memory.total} unit="Gi" />
              <ResourceCell used={node.storage.used} total={node.storage.total} unit="Gi" />
            </button>
          ))}
        </div>
      </div>

      {/* Node detail panel */}
      <NodePanel
        node={selectedNode}
        poolName={poolName}
        onClose={() => setSelectedNode(null)}
      />
    </>
  );
}

function ResourceCell({
  used,
  total,
  unit = "",
}: {
  used: number;
  total: number;
  unit?: string;
}) {
  if (total === 0) {
    return (
      <div className="text-right text-zinc-400 dark:text-zinc-600">—</div>
    );
  }

  const percent = (used / total) * 100;

  return (
    <div className="text-right">
      <span
        className={cn(
          "tabular-nums",
          percent > 90
            ? "text-red-600 dark:text-red-400"
            : percent > 70
              ? "text-amber-600 dark:text-amber-400"
              : "text-zinc-900 dark:text-zinc-100"
        )}
      >
        {used}
      </span>
      <span className="text-zinc-400">/{total}</span>
      {unit && <span className="ml-0.5 text-xs text-zinc-400">{unit}</span>}
    </div>
  );
}
