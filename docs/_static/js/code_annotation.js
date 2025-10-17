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
 * Code Annotations Handler
 * Provides interactive tooltips for annotated code blocks with security and performance optimizations
 */
(() => {
    const MARKER_PATTERN = /#?\s*\((\d{1,5})\)/g;
    const VIEWPORT_PADDING = 12;
    const ICON_SVG = '<svg class="code-annotation-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>';

    // Pre-compile sets for O(1) lookups instead of O(n) string comparisons
    const DANGEROUS_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'style', 'base', 'meta', 'form']);
    const DANGEROUS_ATTRS = new Set(['formaction', 'form', 'formmethod', 'formenctype', 'formtarget', 'style']);
    const URI_ATTRS = new Set(['href', 'src', 'srcset', 'xlink:href']);

    // Configuration
    const USE_LAZY_LOADING = true; // Enable lazy loading for large documents

    let activeTooltip = null;
    let activeMarker = null;
    let cleanupController = null;
    let annotationCounter = 0;
    let isInitialized = false;
    let intersectionObserver = null;

    // Cache the escape div to avoid repeated DOM creation
    const escapeDiv = document.createElement('div');

    /**
     * Clamps a value between min and max
     * @param {number} value - The value to clamp
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @returns {number} Clamped value
     */
    const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

    /**
     * Escapes HTML special characters to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} Escaped HTML string
     */
    const escapeHtml = (str) => {
        escapeDiv.textContent = str;
        return escapeDiv.innerHTML;
    };

    /**
     * Checks if a URI uses a dangerous protocol scheme
     * @param {string} value - URI to check
     * @returns {boolean} True if URI is dangerous
     */
    const isDangerousUri = (value) => {
        let decoded;
        try {
            decoded = decodeURIComponent(value);              // collapse %XX
        } catch {
            decoded = value;                                  // leave unchanged on error
        }
        const normalised = decoded.replace(/\s+/g, '').toLowerCase();
        return /^(javascript:|data:|vbscript:|vbs:|blob:)/.test(normalised);
    };

    /**
     * Checks if a srcset attribute contains any dangerous URIs
     * srcset format: "url1 descriptor1, url2 descriptor2, ..."
     * @param {string} srcsetValue - The srcset attribute value
     * @returns {boolean} True if any URL in srcset is dangerous
     */
    const hasDangerousSrcset = (srcsetValue) => {
        // Split by comma to get individual entries
        const entries = srcsetValue.split(',');

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i].trim();
            if (!entry) continue;

            // Extract URL (first token before whitespace)
            // Format: "url descriptor" or just "url"
            const spaceIndex = entry.search(/\s/);
            const url = spaceIndex === -1 ? entry : entry.substring(0, spaceIndex);

            if (isDangerousUri(url)) {
                return true;
            }
        }

        return false;
    };

    /**
     * Sanitizes a DOM node by removing dangerous elements and attributes
     * @param {Node} node - The node to sanitize
     * @returns {Node|null} Sanitized node or null if node should be removed
     */
    const sanitizeNode = (node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return node;

        // O(1) Set lookup instead of multiple string comparisons
        const tagName = node.tagName.toLowerCase();
        if (DANGEROUS_TAGS.has(tagName)) {
            return null;
        }

        // Iterate attributes directly without creating array copy
        const attrs = node.attributes;
        const attrsToRemove = [];

        for (let i = 0; i < attrs.length; i++) {
            const attr = attrs[i];
            const attrName = attr.name.toLowerCase();

            // Fast path: check event handlers first (most common) - with length check
            if (attrName.length >= 2 &&
                attrName.charCodeAt(0) === 111 &&
                attrName.charCodeAt(1) === 110) { // 'on'
                attrsToRemove.push(attr.name);
                continue;
            }

            // O(1) Set lookup for dangerous attributes
            if (DANGEROUS_ATTRS.has(attrName) || attrName.startsWith('xmlns')) {
                attrsToRemove.push(attr.name);
                continue;
            }

            // Check URI attributes - special handling for srcset
            if (URI_ATTRS.has(attrName)) {
                let isDangerous = false;

                if (attrName === 'srcset') {
                    // srcset has special format with multiple URLs
                    isDangerous = hasDangerousSrcset(attr.value);
                } else {
                    // Single URL attributes (href, src, xlink:href)
                    isDangerous = isDangerousUri(attr.value);
                }

                if (isDangerous) {
                    attrsToRemove.push(attr.name);
                }
            }
        }

        // Remove attributes in a separate loop to avoid live collection issues
        for (let i = 0; i < attrsToRemove.length; i++) {
            node.removeAttribute(attrsToRemove[i]);
        }

        // Iterate child nodes directly without array allocation
        const childNodes = node.childNodes;
        for (let i = childNodes.length - 1; i >= 0; i--) {
            const child = childNodes[i];
            const sanitized = sanitizeNode(child);
            if (sanitized === null) {
                node.removeChild(child);
            }
        }

        return node;
    };

    /**
     * Creates a throttled version of a function using requestAnimationFrame
     * @param {Function} func - Function to throttle
     * @returns {Function} Throttled function
     */
    const throttleRAF = (func) => {
        let rafId = null;
        let lastArgs = null;
        let lastThis = null;

        return function(...args) {
            lastArgs = args;
            lastThis = this;
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                func.apply(lastThis, lastArgs);
                rafId = null;
            });
        };
    };

    /**
     * Positions the active tooltip relative to its marker
     */
    const positionTooltip = () => {
        if (!activeTooltip || !activeMarker) return;

        const markerRect = activeMarker.getBoundingClientRect();
        const tooltipRect = activeTooltip.getBoundingClientRect();

        // Calculate centers - use multiplication for correct fractional handling
        const markerCenterX = markerRect.left + markerRect.width * 0.5;
        const markerCenterY = markerRect.top + markerRect.height * 0.5;

        const left = clamp(
            markerCenterX + window.scrollX,
            VIEWPORT_PADDING,
            window.innerWidth - tooltipRect.width - VIEWPORT_PADDING
        );

        // Update position - direct property access is more reliable than cssText
        activeTooltip.style.left = `${left}px`;

        const desiredTop = markerCenterY + window.scrollY;
        const maxTop = window.scrollY + window.innerHeight - tooltipRect.height - VIEWPORT_PADDING;
        activeTooltip.style.top = `${clamp(desiredTop, VIEWPORT_PADDING + window.scrollY, maxTop)}px`;
    };

    // Use RAF-based throttle for scroll/resize (smoother than time-based)
    const throttledPositionTooltip = throttleRAF(positionTooltip);

    /**
     * Closes the currently active tooltip with animation
     */
    const closeTooltip = () => {
        if (!activeTooltip) return;

        const tooltip = activeTooltip;
        const marker = activeMarker;

        // Clear state first
        activeTooltip = null;
        activeMarker = null;

        // Cleanup
        if (marker) {
            marker.classList.remove('active');
            marker.setAttribute('aria-expanded', 'false');
        }

        cleanupController?.abort();
        cleanupController = null;

        // Animate out
        tooltip.classList.remove('visible');

        // Use transitionend with fallback
        const handleTransitionEnd = () => {
            if (tooltip.parentNode) setTimeout(() => tooltip.remove(), 300);
        };

        tooltip.addEventListener('transitionend', handleTransitionEnd, { once: true });

        // Fallback timeout
        setTimeout(() => {
            if (tooltip.parentNode) {
                tooltip.removeEventListener('transitionend', handleTransitionEnd);
                tooltip.remove();
            }
        }, 300);
    };

    /**
     * Shows a tooltip for the given marker with sanitized content
     * @param {HTMLElement} marker - The annotation marker element
     */
    const showTooltip = (marker) => {
        const tooltip = document.createElement('div');
        tooltip.className = 'code-annotation-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.setAttribute('tabindex', '0');

        // Securely get content from template element
        const annotationId = marker.dataset.annotationId;
        if (!annotationId || typeof annotationId !== 'string') {
            console.warn('Code annotation marker missing valid data-annotation-id');
            return;
        }

        // Additional validation: ensure ID doesn't contain path traversal
        if (annotationId.includes('/') || annotationId.includes('\\') || annotationId.includes('..')) {
            console.warn('Invalid annotation ID format');
            return;
        }

        const template = document.getElementById(annotationId);
        if (!template) {
            console.warn(`Template not found for annotation ID: ${annotationId}`);
            return;
        }

        const templateContent = template.content || template;
        if (templateContent.childNodes.length === 0) return;

        // Optimized: Single pass through nodes, no intermediate arrays
        const fragment = document.createDocumentFragment();
        const clonedContent = templateContent.cloneNode(true);
        const childNodes = clonedContent.childNodes;

        for (let i = childNodes.length - 1; i >= 0; i--) {
            const node = childNodes[i];
            if (node.nodeName === 'SCRIPT') {
                node.remove();
            } else {
                const sanitized = sanitizeNode(node);
                if (sanitized === null) {
                    node.remove();
                }
            }
        }

        // Append all sanitized nodes at once
        while (clonedContent.firstChild) {
            fragment.appendChild(clonedContent.firstChild);
        }
        tooltip.appendChild(fragment);

        document.body.appendChild(tooltip);
        marker.classList.add('active');
        marker.setAttribute('aria-expanded', 'true');

        setTimeout(() => tooltip.focus(), 100);

        // Setup state
        activeTooltip = tooltip;
        activeMarker = marker;

        // Setup event listeners with cleanup
        cleanupController = new AbortController();
        const { signal } = cleanupController;

        window.addEventListener('scroll', throttledPositionTooltip, { capture: true, passive: true, signal });
        window.addEventListener('resize', throttledPositionTooltip, { passive: true, signal });

        // Initial position and animate in
        positionTooltip();
        requestAnimationFrame(() => tooltip.classList.add('visible'));
    };

    /**
     * Toggles tooltip visibility for a marker
     * @param {HTMLElement} marker - The annotation marker element
     */
    const toggleTooltip = (marker) => {
        // Optimized: only close if switching to a different marker or closing the same one
        if (activeMarker === marker) {
            closeTooltip();
        } else {
            // Close current tooltip if any (closeTooltip already checks), then show new one
            closeTooltip();
            showTooltip(marker);
        }
    };

    /**
     * Handles click events for markers and tooltip dismissal
     * @param {MouseEvent} event - Click event
     */
    const handleClick = (event) => {
        const marker = event.target.closest('.code-annotation-marker');

        if (marker) {
            event.preventDefault();
            toggleTooltip(marker);
        } else if (activeTooltip && !event.target.closest('.code-annotation-tooltip')) {
            closeTooltip();
        }
    };

    /**
     * Handles keyboard events for accessibility
     * @param {KeyboardEvent} event - Keyboard event
     */
    const handleKeydown = (event) => {
        if (event.key === 'Escape' && activeTooltip) {
            // Save marker reference before closing (since closeTooltip sets it to null)
            const markerToFocus = activeMarker;
            closeTooltip();
            // Return focus to the marker for better keyboard accessibility
            if (markerToFocus) markerToFocus.focus();
        } else if ((event.key === 'Enter' || event.key === ' ') &&
                   event.target.matches('.code-annotation-marker')) {
            event.preventDefault();
            toggleTooltip(event.target);
        }
    };

    /**
     * Sets up annotation markers and tooltips for a code block
     * @param {HTMLElement} block - The code block element
     */
    const setupAnnotationBlock = (block) => {
        const annotationsList = block.nextElementSibling;
        if (!annotationsList?.matches('ol')) return;

        const annotations = annotationsList.querySelectorAll('li');
        if (annotations.length === 0) return;

        annotationsList.style.display = 'none';

        const preElement = block.querySelector('pre');
        if (!preElement) return;

        const templateParts = []; // Store templates separately

        /**
         * Recursively walks through DOM nodes and replaces annotation markers in text nodes
         * @param {Node} node - Current node to process
         */
        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                // Process text node for annotation markers
                const text = node.textContent;
                const matches = [];
                MARKER_PATTERN.lastIndex = 0;
                let match;

                // Find all matches in this text node
                while ((match = MARKER_PATTERN.exec(text)) !== null) {
                    const annotationIndex = parseInt(match[1], 10) - 1;

                    // Validate annotation index is within bounds
                    if (annotationIndex < 0 || annotationIndex >= annotations.length) {
                        console.warn(`Invalid annotation index: ${annotationIndex + 1}`);
                        continue;
                    }

                    const annotation = annotations[annotationIndex];
                    if (!annotation) {
                        console.warn(`Annotation not found at index: ${annotationIndex}`);
                        continue;
                    }

                    matches.push({
                        index: match.index,
                        length: match[0].length,
                        annotationIndex,
                        annotation
                    });
                }

                // Replace matches in reverse order to maintain correct indices
                if (matches.length > 0) {
                    const fragment = document.createDocumentFragment();
                    let lastIndex = 0;

                    matches.forEach(matchInfo => {
                        // Generate secure, unique ID
                        annotationCounter++;
                        const annotationId = `code-annotation-${annotationCounter}`;
                        const safeId = annotationId.replace(/[^a-zA-Z0-9\-_]/g, '');
                        const safeAnnotationNum = escapeHtml(String(matchInfo.annotationIndex + 1));

                        // Sanitize annotation content before storing
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = matchInfo.annotation.innerHTML;

                        // Remove scripts first
                        const scripts = tempDiv.querySelectorAll('script');
                        for (let i = 0; i < scripts.length; i++) {
                            scripts[i].remove();
                        }

                        // Apply sanitization to all nodes (iterate backward to handle removals)
                        const childNodes = tempDiv.childNodes;
                        for (let i = childNodes.length - 1; i >= 0; i--) {
                            const childNode = childNodes[i];
                            const sanitized = sanitizeNode(childNode);
                            if (sanitized === null) {
                                tempDiv.removeChild(childNode);
                            }
                        }

                        // Add text before the match
                        if (matchInfo.index > lastIndex) {
                            fragment.appendChild(
                                document.createTextNode(text.substring(lastIndex, matchInfo.index))
                            );
                        }

                        // Create and add the button marker
                        const button = document.createElement('button');
                        button.className = 'code-annotation-marker';
                        button.type = 'button';
                        button.dataset.annotationId = safeId;
                        button.setAttribute('aria-label', `Show annotation ${safeAnnotationNum}`);
                        button.setAttribute('aria-expanded', 'false');
                        button.innerHTML = ICON_SVG;
                        fragment.appendChild(button);

                        // Store template separately (will be inserted after <pre>)
                        templateParts.push(`<template id="${safeId}">${tempDiv.innerHTML}</template>`);

                        lastIndex = matchInfo.index + matchInfo.length;
                    });

                    // Add remaining text after last match
                    if (lastIndex < text.length) {
                        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
                    }

                    // Replace the text node with the fragment
                    node.parentNode.replaceChild(fragment, node);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Recursively process child nodes (in reverse to handle DOM changes safely)
                const children = Array.from(node.childNodes);
                children.forEach(child => processNode(child));
            }
        };

        // Start processing from the pre element
        processNode(preElement);

        // Insert all templates after the <pre> element
        if (templateParts.length > 0) {
            const fragment = document.createDocumentFragment();
            const templatesContainer = document.createElement('div');
            templatesContainer.innerHTML = templateParts.join('');

            while (templatesContainer.firstChild) {
                fragment.appendChild(templatesContainer.firstChild);
            }

            // Insert fragment after <pre> in one operation
            if (preElement.nextSibling) {
                preElement.parentNode.insertBefore(fragment, preElement.nextSibling);
            } else {
                preElement.parentNode.appendChild(fragment);
            }
        }
    };

    /**
     * Sets up lazy loading for annotation blocks using IntersectionObserver
     */
    const setupLazyLoading = () => {
        if (!('IntersectionObserver' in window)) {
            // Fallback: initialize all blocks immediately if IntersectionObserver not supported
            document.querySelectorAll('.annotate.highlight').forEach(setupAnnotationBlock);
            return;
        }

        intersectionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const block = entry.target;
                    setupAnnotationBlock(block);
                    intersectionObserver.unobserve(block); // Only initialize once
                }
            });
        }, {
            rootMargin: '50px' // Start loading slightly before block comes into view
        });

        // Observe all annotation blocks
        document.querySelectorAll('.annotate.highlight').forEach(block => {
            intersectionObserver.observe(block);
        });
    };

    /**
     * Cleans up resources on page unload
     */
    const cleanup = () => {
        // Disconnect intersection observer
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }

        // Close any active tooltip
        if (activeTooltip) {
            closeTooltip();
        }
    };

    /**
     * Initializes the code annotation handler
     */
    const initialize = () => {
        if (isInitialized) {
            console.warn('Code annotation handler already initialized');
            return;
        }

        // Choose initialization strategy
        if (USE_LAZY_LOADING) {
            setupLazyLoading();
        } else {
            // Batch DOM queries and initialize all blocks
            const blocks = document.querySelectorAll('.annotate.highlight');
            blocks.forEach(setupAnnotationBlock);
        }

        // Setup event listeners with delegation
        document.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKeydown);

        // Setup cleanup on page unload
        window.addEventListener('beforeunload', cleanup);

        isInitialized = true;
    };

    // Initialize when ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
