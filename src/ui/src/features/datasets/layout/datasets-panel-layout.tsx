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
 * DatasetsPanelLayout — passthrough layout for /datasets/** pages.
 *
 * The layout-level slide-out panel has been replaced by an always-visible right
 * panel on the dataset detail page. This component is kept as a simple passthrough
 * to preserve the layout.tsx import without breaking the route.
 */

export function DatasetsPanelLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
