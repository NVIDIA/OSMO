/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { BooleanIndicator } from "@/components/boolean-indicator";
import { CopyableBlock } from "@/components/copyable-value";
import type { PlatformConfig } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

interface PlatformConfigContentProps {
  config: PlatformConfig;
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Platform Config Content - Displays platform configuration details.
 *
 * Shows:
 * - Description
 * - Boolean flags (host network, privileged mode)
 * - Default mounts
 * - Allowed mounts
 */
export function PlatformConfigContent({ config }: PlatformConfigContentProps) {
  return (
    <div className="space-y-3">
      {/* Description */}
      {config.description && <p className="text-sm text-muted-foreground">{config.description}</p>}

      {/* Boolean flags */}
      <div className="space-y-1">
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">Host Network</span>
          <BooleanIndicator value={config.hostNetworkAllowed} />
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">Privileged Mode</span>
          <BooleanIndicator value={config.privilegedAllowed} />
        </div>
      </div>

      {/* Default Mounts */}
      {config.defaultMounts.length > 0 && (
        <MountsList title="Default Mounts" mounts={config.defaultMounts} />
      )}

      {/* Allowed Mounts */}
      {config.allowedMounts.length > 0 && (
        <MountsList title="Allowed Mounts" mounts={config.allowedMounts} />
      )}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function MountsList({ title, mounts }: { title: string; mounts: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-sm text-muted-foreground">{title}</div>
      <div className="flex flex-col gap-1">
        {mounts.map((mount, idx) => (
          <CopyableBlock key={idx} value={mount} />
        ))}
      </div>
    </div>
  );
}
