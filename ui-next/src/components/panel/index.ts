/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
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

export {
  ResizablePanel,
  type ResizablePanelProps,
} from "./resizable-panel";

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
