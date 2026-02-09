// SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

(function() {
    'use strict';
    
    // SVG icons (chevron arrows as transparent cutout) - SINGLE SOURCE OF TRUTH
    const SVG_CHEVRON_RIGHT = '<svg viewBox="0 0 16 16" class="collapsible-icon"><path d="M6 4l4 4-4 4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const SVG_CHEVRON_DOWN = '<svg viewBox="0 0 16 16" class="collapsible-icon"><path d="M4 6l4 4 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    /**
     * Initialize all collapsible toggle buttons with the appropriate icons
     */
    function initializeCollapsibleIcons() {
        const toggles = document.querySelectorAll('.collapsible-toggle');
        toggles.forEach(function(toggle) {
            const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
            toggle.innerHTML = isExpanded ? SVG_CHEVRON_DOWN : SVG_CHEVRON_RIGHT;
        });
    }

    /**
     * Toggle the visibility of a collapsible code section
     * @param {string} id - The unique identifier for the collapsible section
     */
    function toggleCollapsible(id) {
        // Use attribute selector with proper escaping to prevent injection
        const wrapper = document.querySelector('[data-collapsible-id="' + CSS.escape(id) + '"]');
        if (!wrapper) {
            console.warn('Collapsible wrapper not found for id:', id);
            return;
        }
        
        const toggle = wrapper.querySelector('.collapsible-toggle');
        if (!toggle) {
            console.warn('Collapsible toggle button not found for id:', id);
            return;
        }

        const isOpen = wrapper.classList.contains('open');
        
        if (isOpen) {
            // Collapse
            toggle.innerHTML = SVG_CHEVRON_RIGHT;
            toggle.setAttribute('aria-expanded', 'false');
            wrapper.classList.remove('open');
        } else {
            // Expand
            toggle.innerHTML = SVG_CHEVRON_DOWN;
            toggle.setAttribute('aria-expanded', 'true');
            wrapper.classList.add('open');
        }
    }
    
    // Initialize on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeCollapsibleIcons);
    } else {
        initializeCollapsibleIcons();
    }
    
    // Expose to global scope for onclick handlers
    window.toggleCollapsible = toggleCollapsible;
})();
