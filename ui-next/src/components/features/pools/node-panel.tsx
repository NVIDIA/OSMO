"use client";

// Copyright (c) 2024-2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { X, Check, Ban, FolderOpen } from "lucide-react";
import Link from "next/link";
import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useResourceInfo, type Node, type PlatformConfig } from "@/lib/api/adapter";

interface NodePanelProps {
  node: Node | null;
  poolName: string;
  platformConfigs: Record<string, PlatformConfig>;
  onClose: () => void;
}

export function NodePanel({ node, poolName, platformConfigs, onClose }: NodePanelProps) {
  // Fetch full resource info to get all pool memberships
  const { poolMemberships, isLoading: membershipsLoading } = useResourceInfo(node?.nodeName ?? null);

  if (!node) return null;

  // Get task config for the current pool/platform
  const taskConfig = platformConfigs[node.platform];

  // Use fetched memberships if available, fallback to node's partial data
  const displayMemberships = poolMemberships.length > 0 ? poolMemberships : node.poolMemberships;

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
          {/* Pool Memberships */}
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Pool Memberships
            </h3>
            {membershipsLoading ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
                  Loading...
                </div>
              </div>
            ) : displayMemberships.length > 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800">
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                        Pool
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                        Platform
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {displayMemberships.map((membership, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          <Link
                            href={`/pools/${membership.pool}`}
                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {membership.pool}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          {membership.platform}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                No pool memberships found
              </div>
            )}
          </section>

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

          {/* Task Configurations */}
          {taskConfig && (
            <section>
              <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Task Configurations
              </h3>
              <div className="space-y-3">
                {/* Boolean flags */}
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      Host Network Allowed
                    </span>
                    <BooleanIndicator value={taskConfig.hostNetworkAllowed} />
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      Privileged Mode Allowed
                    </span>
                    <BooleanIndicator value={taskConfig.privilegedAllowed} />
                  </div>
                </div>

                {/* Default Mounts */}
                {taskConfig.defaultMounts.length > 0 && (
                  <MountsList title="Default Mounts" mounts={taskConfig.defaultMounts} />
                )}

                {/* Allowed Mounts */}
                {taskConfig.allowedMounts.length > 0 && (
                  <MountsList title="Allowed Mounts" mounts={taskConfig.allowedMounts} />
                )}
              </div>
            </section>
          )}

          {/* Configuration */}
          <section>
            <h3 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Node Info
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

function BooleanIndicator({ value }: { value: boolean }) {
  return value ? (
    <span className="flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
      <Check className="h-4 w-4" />
      Yes
    </span>
  ) : (
    <span className="flex items-center gap-1 text-sm font-medium text-zinc-400">
      <Ban className="h-4 w-4" />
      No
    </span>
  );
}

function MountsList({ title, mounts }: { title: string; mounts: string[] }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-zinc-400">
        <FolderOpen className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-1">
        {mounts.map((mount, idx) => (
          <div
            key={idx}
            className="rounded bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {mount}
          </div>
        ))}
      </div>
    </div>
  );
}
