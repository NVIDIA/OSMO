//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Tree Connector Component
 *
 * Renders visual tree hierarchy connectors using Unicode box-drawing characters.
 * Single-task groups display a dot, multi-task groups display L-bracket connectors.
 */

export interface TreeConnectorProps {
  position: "first" | "middle" | "last";
  isSingleTask: boolean;
}

/**
 * Tree connector using Unicode box-drawing characters
 */
export function TreeConnector({ position, isSingleTask }: TreeConnectorProps): React.JSX.Element {
  if (isSingleTask) {
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <span className="text-muted-foreground text-base">•</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <span
        className="text-muted-foreground absolute text-sm"
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      >
        {position === "last" ? "└" : "├"}
      </span>
    </div>
  );
}
