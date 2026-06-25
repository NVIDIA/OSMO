//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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
 * Tab-Set Deep Linking
 * 
 * Enables direct linking to specific tabs in any tab-set using URL fragments.
 * Example: #task-lifecycle-running will open the RUNNING tab in the lifecycle tab-set
 */

(function() {
  'use strict';

  /**
   * Get all tab-set containers in the document
   */
  function getAllTabSets() {
    return Array.from(document.querySelectorAll('.sd-tab-set'));
  }

  /**
   * Get all tab labels within a tab-set
   */
  function getTabLabels(container) {
    return container ? Array.from(container.querySelectorAll('label')) : [];
  }

  /**
   * Convert text to a URL-friendly slug
   */
  function slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')        // Replace spaces with -
      .replace(/[^\w\-]+/g, '')    // Remove all non-word chars
      .replace(/\-\-+/g, '-')      // Replace multiple - with single -
      .replace(/^-+/, '')          // Trim - from start of text
      .replace(/-+$/, '');         // Trim - from end of text
  }

  /**
   * Get the context ID for a tab-set (from nearest heading or section)
   */
  function getTabSetContext(tabSet) {
    // Look for the nearest parent section with an ID
    let element = tabSet.parentElement;
    while (element) {
      if (element.id) {
        return element.id;
      }
      element = element.parentElement;
    }
    
    // Look for the nearest preceding heading with an ID
    let sibling = tabSet.previousElementSibling;
    while (sibling) {
      if (sibling.id) {
        return sibling.id;
      }
      // Check if it's a heading element
      if (/^H[1-6]$/.test(sibling.tagName)) {
        // Generate an ID from the heading text if it doesn't have one
        return slugify(sibling.textContent);
      }
      sibling = sibling.previousElementSibling;
    }
    
    return 'tabs';
  }

  /**
   * Generate a fragment ID for a tab
   */
  function generateTabFragment(tabSet, tabLabel) {
    const context = getTabSetContext(tabSet);
    const labelSlug = slugify(tabLabel);
    return `${context}-${labelSlug}`;
  }

  /**
   * Get the input associated with a label
   */
  function getTabInput(label) {
    const inputId = label.getAttribute('for');
    return inputId ? document.getElementById(inputId) : null;
  }

  /**
   * Find and activate a tab by matching the fragment
   */
  function activateTabByFragment(fragment) {
    if (!fragment) return null;

    const tabSets = getAllTabSets();
    
    for (const tabSet of tabSets) {
      const labels = getTabLabels(tabSet);
      
      for (const label of labels) {
        const labelText = label.textContent.trim();
        const tabFragment = generateTabFragment(tabSet, labelText);
        
        if (tabFragment === fragment) {
          const input = getTabInput(label);
          if (input) {
            input.checked = true;
            return tabSet;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Update URL hash when a tab is clicked
   */
  function setupTabClickHandlers() {
    const tabSets = getAllTabSets();
    
    tabSets.forEach(tabSet => {
      const labels = getTabLabels(tabSet);
      
      labels.forEach(label => {
        label.addEventListener('click', function() {
          const labelText = this.textContent.trim();
          const fragment = generateTabFragment(tabSet, labelText);
          
          // Update URL without triggering scroll or page reload
          history.replaceState(null, '', '#' + fragment);
        });
      });
    });
  }

  /**
   * Activate tab based on URL hash
   */
  function activateTabFromHash() {
    const hash = window.location.hash.substring(1); // Remove the '#'
    if (!hash) return null;

    return activateTabByFragment(hash);
  }

  /**
   * Handle hash changes (e.g., browser back/forward)
   */
  function handleHashChange() {
    activateTabFromHash();
  }

  /**
   * Scroll to a tab-set or its context section
   */
  function scrollToTabSet(tabSet) {
    if (!tabSet) return;
    
    // Try to scroll to the context section first
    const contextId = getTabSetContext(tabSet);
    const contextElement = document.getElementById(contextId);
    
    if (contextElement) {
      contextElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Fallback to scrolling to the tab-set itself
      tabSet.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /**
   * Activate tab based on URL hash on page load
   */
  function activateTabOnLoad() {
    const hash = window.location.hash.substring(1);
    if (!hash) return;

    // Try to activate the tab
    const activatedTabSet = activateTabFromHash();
    
    if (activatedTabSet) {
      // Scroll to the tab-set or its section after activating the tab
      // Use a small delay to ensure the tab is fully activated
      setTimeout(() => scrollToTabSet(activatedTabSet), 100);
    }
  }

  /**
   * Initialize the deep linking functionality
   */
  function init() {
    // Wait for DOM to be fully loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setupTabClickHandlers();
        activateTabOnLoad();
      });
    } else {
      setupTabClickHandlers();
      activateTabOnLoad();
    }

    // Handle browser back/forward navigation
    window.addEventListener('hashchange', handleHashChange);
  }

  // Start initialization
  init();
})();
