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

import { useEffect, useRef, useState, useCallback, useMemo } from "react";

interface UseActiveSectionReturn {
  activeSection: string | null;
  scrollToSection: (id: string) => void;
}

/**
 * Hook to track which section is currently active based on scroll position
 * Uses Intersection Observer for reliable detection regardless of scroll container
 * Handles programmatic scrolling smoothly without interference
 *
 * @param sectionIds - Array of section IDs to track
 * @returns Object with activeSection and scrollToSection function
 */
export function useActiveSection(sectionIds: string[]): UseActiveSectionReturn {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scrollToSection = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element) {
      // Set flag to prevent active tracking during programmatic scroll
      isScrollingRef.current = true;

      // Immediately update active state to clicked section for instant feedback
      setActiveSection(id);

      // Clear any pending timeout
      if (scrollTimeoutRef.current !== undefined) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Perform smooth scroll
      element.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      // Re-enable tracking after scroll completes (smooth scroll takes ~500-1000ms)
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 1000);
    }
  }, []);

  useEffect(() => {
    // Track intersection ratios for all sections
    const intersectionRatios = new Map<string, number>();

    // Create intersection observer
    const observer = new IntersectionObserver(
      (entries) => {
        // Skip updates during programmatic scrolling
        if (isScrollingRef.current) {
          return;
        }

        // Update intersection ratios
        entries.forEach((entry) => {
          const sectionId = entry.target.id;
          if (sectionId) {
            intersectionRatios.set(sectionId, entry.intersectionRatio);
          }
        });

        // Find the section with highest intersection ratio
        let maxRatio = -1;
        let maxSection: string | null = null;

        // Check in order of sectionIds to maintain priority when ratios are equal
        sectionIds.forEach((id) => {
          const ratio = intersectionRatios.get(id) || 0;
          if (ratio > maxRatio) {
            maxRatio = ratio;
            maxSection = id;
          }
        });

        // Update active section if we found one
        if (maxSection) {
          setActiveSection(maxSection);
        }
      },
      {
        // Root margin creates a "active zone" in the middle of viewport
        rootMargin: "-20% 0px -50% 0px",
        // Multiple thresholds for smooth detection
        threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      },
    );

    // Observe all sections
    const elements: Element[] = [];
    sectionIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
        elements.push(element);
      }
    });

    // Cleanup
    return () => {
      if (scrollTimeoutRef.current !== undefined) {
        clearTimeout(scrollTimeoutRef.current);
      }
      elements.forEach((element) => observer.unobserve(element));
      observer.disconnect();
    };
  }, [sectionIds]);

  return useMemo(() => ({ activeSection, scrollToSection }), [activeSection, scrollToSection]);
}
