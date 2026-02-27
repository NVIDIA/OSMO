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
 * Datasets panel store — ephemeral state for the layout-level dataset details panel.
 *
 * Tracks which dataset (bucket + name) is selected and whether the panel is open.
 * Not persisted — resets on page reload.
 */

import { create } from "zustand";

interface DatasetsPanelState {
  bucket: string | null;
  name: string | null;
  isOpen: boolean;
  open: (bucket: string, name: string) => void;
  close: () => void;
}

export const useDatasetsPanel = create<DatasetsPanelState>((set) => ({
  bucket: null,
  name: null,
  isOpen: false,
  open: (bucket, name) => set({ bucket, name, isOpen: true }),
  close: () => set({ isOpen: false }),
}));
