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

/**
 * CollectionPanelMembers — Members section for the collection slideout panel.
 *
 * Card with a compact table: dataset name, version, size.
 */

"use client";

import { Card, CardContent } from "@/components/shadcn/card";
import { formatBytes } from "@/lib/utils";
import type { CollectionMember } from "@/lib/api/adapter/datasets";

interface CollectionPanelMembersProps {
  members: CollectionMember[];
}

export function CollectionPanelMembers({ members }: CollectionPanelMembersProps) {
  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">Members</h3>

      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          {members.length === 0 ? (
            <div className="text-muted-foreground flex h-16 items-center justify-center text-sm">
              No members available
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">Dataset</th>
                    <th className="text-muted-foreground px-3 py-2 text-left text-xs font-medium">Version</th>
                    <th className="text-muted-foreground px-3 py-2 text-right text-xs font-medium">Size</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {members.map((member) => {
                    const sizeGib = member.size / 1024 ** 3;
                    return (
                      <tr key={member.id}>
                        <td className="px-3 py-2 font-mono">{member.name}</td>
                        <td className="text-muted-foreground px-3 py-2">v{member.version}</td>
                        <td className="px-3 py-2 text-right font-mono">{formatBytes(sizeGib).display}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
