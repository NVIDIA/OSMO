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
 * Datasets Route Layout
 *
 * Mounts the shared dataset details panel for all /datasets/** pages.
 * The panel persists across navigation between the list and detail pages
 * so it does not close/reopen when the user clicks "Browse files" or a version.
 */

import { DatasetsPanelLayout } from "@/features/datasets/layout/datasets-panel-layout";

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  return <DatasetsPanelLayout>{children}</DatasetsPanelLayout>;
}
