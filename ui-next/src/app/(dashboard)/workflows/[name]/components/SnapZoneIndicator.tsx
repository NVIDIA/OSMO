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
import { useMounted } from "@/hooks/use-mounted";
import { usePanelWidth } from "../lib/panel-resize-context";
import { computeSnapIndicatorGeometry } from "../lib/panel-constants";

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
 * Tracks element bounds using ResizeObserver and scroll events.
 * More efficient than RAF loop - only updates when element actually changes.
 */
function useElementBounds(ref: RefObject<HTMLElement | null> | undefined, isActive: boolean): Bounds | null {
  const [bounds, setBounds] = useState<Bounds | null>(null);

  useEffect(() => {
    if (!isActive || !ref?.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronizing with DOM element position
      setBounds(null);
      return;
    }

    const element = ref.current;

    const updateBounds = () => {
      const rect = element.getBoundingClientRect();
      setBounds({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };

    // Measure immediately
    updateBounds();

    // Update on resize
    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(element);

    // Update on scroll (position changes even if size doesn't)
    window.addEventListener("scroll", updateBounds, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("scroll", updateBounds);
    };
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
}

/** Strip snap indicator (< 20%) showing washout effect + target line via portal */
export const StripSnapIndicator = memo(function StripSnapIndicator({
  isActive,
  containerRef,
}: StripSnapIndicatorProps) {
  // Read current panel width from manager
  const currentPct = usePanelWidth();

  const portalContainer = usePortalContainer();
  const containerBounds = useElementBounds(containerRef, isActive);

  if (!isActive || !portalContainer || !containerBounds) return null;

  // Calculate overlay geometry using pure function
  const geometry = computeSnapIndicatorGeometry(currentPct, containerBounds.width);
  if (!geometry) return null;

  const { overlayLeftPx, overlayWidthPx } = geometry;

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
