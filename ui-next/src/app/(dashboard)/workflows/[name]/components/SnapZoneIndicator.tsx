//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0

/**
 * Snap Zone Preview Indicators
 *
 * Uses React Portals to escape stacking context barriers (CSS containment, transforms).
 * Renders at document.body level with getBoundingClientRect() positioning.
 */

"use client";

import { memo, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMounted } from "@/hooks";
import { usePanelWidth } from "../lib/panel-resize-context";

function getOrCreatePortalContainer(): HTMLElement {
  let portalRoot = document.getElementById("snap-zone-portal");
  if (!portalRoot) {
    portalRoot = document.createElement("div");
    portalRoot.id = "snap-zone-portal";
    portalRoot.className = "snap-zone-portal";
    document.body.appendChild(portalRoot);
  }
  return portalRoot;
}

/** Returns portal container after hydration, null during SSR */
function usePortalContainer(): HTMLElement | null {
  const isMounted = useMounted();
  if (!isMounted) return null;
  return getOrCreatePortalContainer();
}

interface Bounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Continuously tracks element bounds via RAF loop while active.
 * Polls for ref availability since refs don't trigger re-renders.
 */
function useElementBounds(ref: RefObject<HTMLElement | null> | undefined, isActive: boolean): Bounds | null {
  const [bounds, setBounds] = useState<Bounds | null>(null);

  useEffect(() => {
    if (!isActive || !ref) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizing with DOM element position
      setBounds(null);
      return;
    }

    let rafId: number;
    let element: HTMLElement | null = null;

    const measureLoop = () => {
      if (!element && ref.current) {
        element = ref.current;
      }
      if (element) {
        const rect = element.getBoundingClientRect();
        setBounds({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      }
      rafId = requestAnimationFrame(measureLoop);
    };

    measureLoop();
    return () => cancelAnimationFrame(rafId);
  }, [ref, isActive]);

  return bounds;
}

interface FullSnapOverlayProps {
  isActive: boolean;
}

/** Full-width snap preview overlay rendered inside DAG container */
export const FullSnapOverlay = memo(function FullSnapOverlay({ isActive }: FullSnapOverlayProps) {
  if (!isActive) return null;

  return (
    <div
      className="snap-full-overlay"
      role="status"
      aria-live="polite"
      aria-label="Panel will expand to full width, hiding the DAG"
    >
      <div
        className="snap-full-target-line"
        style={{ left: 0 }}
      />
    </div>
  );
});

interface StripSnapIndicatorProps {
  isActive: boolean;
  containerRef?: RefObject<HTMLElement | null>;
  stripWidthPx: number;
}

/** Strip snap indicator (< 20%) showing washout effect + target line via portal */
export const StripSnapIndicator = memo(function StripSnapIndicator({
  isActive,
  containerRef,
  stripWidthPx,
}: StripSnapIndicatorProps) {
  // Read current panel width from manager
  const currentPct = usePanelWidth();

  const portalContainer = usePortalContainer();
  const containerBounds = useElementBounds(containerRef, isActive);

  if (!isActive || !portalContainer || !containerBounds) return null;

  // Overlay is inside the panel, starting after the activity strip
  const containerWidth = containerBounds.width;
  const panelWidthPx = containerWidth * (currentPct / 100);
  const panelLeftPx = containerWidth - panelWidthPx; // Panel grows from right

  // Overlay starts at the right edge of the activity strip (inside the panel)
  const overlayLeftPx = panelLeftPx + stripWidthPx;
  const overlayWidthPx = panelWidthPx - stripWidthPx;

  if (overlayWidthPx <= 0) return null;

  return createPortal(
    <div
      className="snap-strip-container"
      style={{
        position: "absolute",
        top: containerBounds.top,
        height: containerBounds.height,
        left: containerBounds.left + overlayLeftPx,
        width: overlayWidthPx,
      }}
      role="status"
      aria-live="polite"
      aria-label="Panel will snap to activity strip width"
    >
      <div
        className="snap-strip-washout"
        style={{ width: "100%" }}
      />
      <div
        className="snap-strip-target-line"
        style={{ left: 0 }}
      />
    </div>,
    portalContainer,
  );
});
