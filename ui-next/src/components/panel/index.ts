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

/**
 * Panel Components
 *
 * Shared components for resizable side panels:
 * - ResizablePanel: Main panel container with drag-to-resize
 * - PanelHeaderActions: Header controls (badge, menu, close)
 * - PanelWidthMenu: Dropdown for width presets
 * - PanelCloseButton: Close button
 */

export { ResizablePanel, type ResizablePanelProps } from "./resizable-panel";

export {
  PANEL,
  PanelHeaderActions,
  PanelWidthMenu,
  PanelCloseButton,
  WIDTH_PRESET_ICONS,
  type PanelHeaderActionsProps,
  type PanelWidthMenuProps,
  type PanelCloseButtonProps,
} from "./panel-header-controls";
