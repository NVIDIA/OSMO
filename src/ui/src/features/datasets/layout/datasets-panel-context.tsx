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
 * DatasetsPanelContext — passes panel open/close controls down to page components.
 *
 * The panel lives at the layout level (`DatasetsPanelLayout`) and needs to be
 * controllable from within both the list and detail page client components.
 */

"use client";

import { createContext, useContext } from "react";

export interface DatasetsPanelContextValue {
  /** Whether the details panel is currently open (lifecycle-aware — false during close animation) */
  isPanelOpen: boolean;
  /** Open the panel for the given dataset */
  openPanel: (bucket: string, name: string) => void;
  /** Close the panel (triggers slide-out animation) */
  closePanel: () => void;
}

export const DatasetsPanelContext = createContext<DatasetsPanelContextValue | null>(null);

export function useDatasetsPanelContext(): DatasetsPanelContextValue {
  const ctx = useContext(DatasetsPanelContext);
  if (!ctx) throw new Error("useDatasetsPanelContext must be used within DatasetsPanelLayout");
  return ctx;
}
