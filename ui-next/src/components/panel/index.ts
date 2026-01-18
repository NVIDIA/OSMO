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
 * - ResizablePanel: Main panel container with drag-to-resize and optional collapse
 * - PanelCollapsedStrip: Generic collapsed state content with expand button
 * - PanelHeader: Base header with slot-based layout (title, actions, subtitle, expandable)
 * - PanelHeaderActions: Header controls (badge, menu, close)
 * - Helper components: PanelBackButton, PanelBadge, PanelCollapseButton, PanelTitle, PanelSubtitle
 */

export { ResizablePanel, type ResizablePanelProps } from "./resizable-panel";

export { SidePanel, type SidePanelProps } from "./side-panel";

export { PanelCollapsedStrip, type PanelCollapsedStripProps } from "./panel-collapsed-strip";

export { ResizeHandle, type ResizeHandleProps } from "./resize-handle";

export {
  PANEL,
  WIDTH_PRESET_ICONS,
  PanelHeaderContainer,
  WidthPresetMenuItems,
  PanelWidthMenu,
  PanelCloseButton,
  PanelHeaderActions,
  type PanelHeaderContainerProps,
  type WidthPresetMenuItemsProps,
  type PanelWidthMenuProps,
  type PanelCloseButtonProps,
  type PanelHeaderActionsProps,
} from "./panel-header-controls";

export {
  PanelHeader,
  PanelBackButton,
  PanelCollapseButton,
  PanelBadge,
  PanelTitle,
  PanelSubtitle,
  type PanelHeaderProps,
  type PanelHeaderExpandable,
  type PanelBackButtonProps,
  type PanelCollapseButtonProps,
  type PanelBadgeProps,
  type PanelBadgeVariant,
  type PanelTitleProps,
  type PanelSubtitleProps,
} from "./panel-header";

export { useResizablePanel, type UseResizablePanelOptions, type UseResizablePanelReturn } from "./use-resizable-panel";

export { PanelTabs, type PanelTab, type PanelTabsProps } from "./panel-tabs";

export { EmptyTabPrompt, type EmptyTabPromptProps } from "./empty-tab-prompt";

export { DetailsSection, type DetailsSectionProps, type DetailsItem } from "./details-section";

export { LinksSection, type LinksSectionProps, type LinkItem } from "./links-section";

export { TabPanel, type TabPanelProps } from "./tab-panel";

export { SeparatedParts, type SeparatedPartsProps } from "./separated-parts";
