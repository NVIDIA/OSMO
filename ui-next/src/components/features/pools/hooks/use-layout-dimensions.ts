/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useState, useEffect } from "react";

interface LayoutDimensions {
  headerHeight: number;
  sectionHeight: number;
  rowHeight: number;
  rowHeightCompact: number;
}

const DEFAULTS: LayoutDimensions = {
  headerHeight: 36,
  sectionHeight: 36,
  rowHeight: 48,
  rowHeightCompact: 32,
};

function parseCssValue(value: string, rootFontSize: number): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("rem")) return parseFloat(trimmed) * rootFontSize;
  if (trimmed.endsWith("px")) return parseFloat(trimmed);
  return parseFloat(trimmed) || 0;
}

export function useLayoutDimensions(): LayoutDimensions {
  const [dimensions, setDimensions] = useState<LayoutDimensions>(DEFAULTS);

  useEffect(() => {
    const root = document.documentElement;
    const rootFontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
    const getCssVar = (name: string, fallback: string) => {
      const val = getComputedStyle(root).getPropertyValue(name).trim() || fallback;
      return parseCssValue(val, rootFontSize);
    };

    setDimensions({
      headerHeight: getCssVar("--pools-header-height", "2.25rem"),
      sectionHeight: getCssVar("--pools-section-height", "2.25rem"),
      rowHeight: getCssVar("--pools-row-height", "3rem"),
      rowHeightCompact: getCssVar("--pools-row-height-compact", "2rem"),
    });
  }, []);

  return dimensions;
}
