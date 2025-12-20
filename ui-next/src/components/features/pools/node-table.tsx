"use client";

import { useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { NodePanel } from "./node-panel";
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
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Node
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Platform
              </th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                GPU
              </th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                CPU
              </th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Memory
              </th>
              <th className="whitespace-nowrap px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Storage
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {nodes.map((node, idx) => (
              <tr
                key={`${node.nodeName}-${node.platform}-${idx}`}
                onClick={() => setSelectedNode(node)}
                className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  <span className="block max-w-[200px] truncate" title={node.nodeName}>
                    {node.nodeName}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {node.platform}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.gpu.used} total={node.gpu.total} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.cpu.used} total={node.cpu.total} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.memory.used} total={node.memory.total} unit="Gi" />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.storage.used} total={node.storage.total} unit="Gi" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  const percent = (used / total) * 100;

  return (
    <span className="inline-flex items-baseline gap-0.5">
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
        {formatNumber(used)}
      </span>
      <span className="text-zinc-400">/{formatNumber(total)}</span>
      {unit && <span className="text-xs text-zinc-400">{unit}</span>}
    </span>
  );
}

