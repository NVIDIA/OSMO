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
 * DatasetsPanelLayout — layout-level dataset details panel.
 *
 * Wraps all /datasets/** pages in a shared ResizablePanel so the details
 * slideout persists across navigation between the list and detail pages.
 *
 * Version selection behavior:
 *   - On the detail page → updates ?version= in the current URL, preserving
 *     ?path= and ?file= so the user stays in their current directory.
 *   - On the list page → navigates to the detail page for that dataset (no version).
 */

"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { usePanelLifecycle } from "@/components/panel/hooks/use-panel-lifecycle";
import { usePanelWidth } from "@/components/panel/hooks/use-panel-width";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { DatasetPanel } from "@/features/datasets/list/components/panel/dataset-panel";
import { DatasetsPanelContext } from "@/features/datasets/layout/datasets-panel-context";
import { useDatasetsPanel } from "@/features/datasets/layout/datasets-panel-store";
import { useDatasetsTableStore } from "@/features/datasets/list/stores/datasets-table-store";
import { useNavigationRouter } from "@/hooks/use-navigation-router";
import { useViewTransition } from "@/hooks/use-view-transition";
import { PANEL } from "@/components/panel/lib/panel-constants";

export function DatasetsPanelLayout({ children }: { children: React.ReactNode }) {
  const bucket = useDatasetsPanel((s) => s.bucket);
  const name = useDatasetsPanel((s) => s.name);
  const version = useDatasetsPanel((s) => s.version);
  const isOpen = useDatasetsPanel((s) => s.isOpen);
  const storeOpen = useDatasetsPanel((s) => s.open);
  const storeClose = useDatasetsPanel((s) => s.close);

  const { panelWidth, setPanelWidth } = usePanelWidth({
    storedWidth: useDatasetsTableStore((s) => s.panelWidth),
    setStoredWidth: useDatasetsTableStore((s) => s.setPanelWidth),
  });

  const router = useNavigationRouter();
  const { startTransition } = useViewTransition();
  const pathname = usePathname();

  // Close panel when the user navigates to a different page.
  // Deliberately omits searchParams — version selection on the detail page changes
  // ?version= without leaving the page, and the panel should remain open.
  useEffect(() => {
    storeClose();
  }, [pathname, storeClose]);

  const { isPanelOpen, handleClose, handleClosed } = usePanelLifecycle({
    hasSelection: isOpen,
    onClosed: storeClose,
  });

  const detailPath = useMemo(
    () => (bucket && name ? `/datasets/${encodeURIComponent(bucket)}/${encodeURIComponent(name)}` : null),
    [bucket, name],
  );

  const handleVersionSelect = useCallback(
    (id: string | null) => {
      if (!detailPath) return;
      if (pathname === detailPath) {
        // Already on detail page — preserve existing URL params (?path=, ?file=) and update version
        const searchParams = new URLSearchParams(window.location.search);
        if (id === null) {
          searchParams.delete("version");
        } else {
          searchParams.set("version", id);
        }
        const qs = searchParams.toString();
        router.push(`${detailPath}${qs ? `?${qs}` : ""}`);
      } else {
        // On list page — navigate to detail page
        startTransition(() => {
          router.push(`${detailPath}${id ? `?version=${id}` : ""}`);
        });
      }
    },
    [router, startTransition, detailPath, pathname],
  );

  return (
    <DatasetsPanelContext.Provider value={{ isPanelOpen, openPanel: storeOpen, closePanel: handleClose }}>
      <ResizablePanel
        open={isPanelOpen}
        onClose={handleClose}
        onClosed={handleClosed}
        width={panelWidth}
        onWidthChange={setPanelWidth}
        minWidth={PANEL.MIN_WIDTH_PCT}
        maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
        mainContent={children}
        backdrop={false}
        aria-label={bucket && name ? `Dataset details: ${name}` : "Datasets"}
        className="datasets-panel"
      >
        {bucket && name && (
          <InlineErrorBoundary
            title="Unable to load dataset details"
            resetKeys={[bucket, name]}
          >
            <DatasetPanel
              bucket={bucket}
              name={name}
              activeVersionId={version ?? undefined}
              onClose={handleClose}
              onVersionSelect={handleVersionSelect}
              showBrowseFiles={pathname !== detailPath}
            />
          </InlineErrorBoundary>
        )}
      </ResizablePanel>
    </DatasetsPanelContext.Provider>
  );
}
