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
 * Code Annotations - Interactive tooltips for annotated code blocks
 */
(() => {
  'use strict';

  const MARKER_PATTERN = /#?\s*\((\d{1,5})\)/g;
  const VIEWPORT_PADDING = 12;
  const ICON_SVG = '<svg class="code-annotation-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>';
  
  const DANGEROUS_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'link', 'style', 'base', 'meta', 'form']);
  const DANGEROUS_ATTRS = new Set(['formaction', 'form', 'formmethod', 'formenctype', 'formtarget', 'style']);
  const URI_ATTRS = new Set(['href', 'src', 'srcset', 'xlink:href']);
  
  const USE_LAZY_LOADING = true;

  let activeTooltip = null;
  let activeMarker = null;
  let cleanupController = null;
  let annotationCounter = 0;
  let isInitialized = false;
  let intersectionObserver = null;

  const escapeDiv = document.createElement('div');

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  const escapeHtml = (str) => {
    escapeDiv.textContent = str;
    return escapeDiv.innerHTML;
  };

  const isDangerousUri = (value) => {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      decoded = value;
    }
    const normalised = decoded.replace(/\s+/g, '').toLowerCase();
    return /^(javascript:|data:|vbscript:|vbs:|blob:)/.test(normalised);
  };

  const hasDangerousSrcset = (srcsetValue) => {
    const entries = srcsetValue.split(',');
    
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i].trim();
      if (!entry) continue;
      
      const spaceIndex = entry.search(/\s/);
      const url = spaceIndex === -1 ? entry : entry.substring(0, spaceIndex);
      
      if (isDangerousUri(url)) return true;
    }
    
    return false;
  };

  const sanitizeNode = (node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return node;

    const tagName = node.tagName.toLowerCase();
    if (DANGEROUS_TAGS.has(tagName)) return null;

    const attrs = node.attributes;
    const attrsToRemove = [];

    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const attrName = attr.name.toLowerCase();

      if (attrName.length >= 2 && attrName.charCodeAt(0) === 111 && attrName.charCodeAt(1) === 110) {
        attrsToRemove.push(attr.name);
        continue;
      }

      if (DANGEROUS_ATTRS.has(attrName) || attrName.startsWith('xmlns')) {
        attrsToRemove.push(attr.name);
        continue;
      }

      if (URI_ATTRS.has(attrName)) {
        const isDangerous = attrName === 'srcset' 
          ? hasDangerousSrcset(attr.value)
          : isDangerousUri(attr.value);
        
        if (isDangerous) attrsToRemove.push(attr.name);
      }
    }

    attrsToRemove.forEach(name => node.removeAttribute(name));

    const childNodes = node.childNodes;
    for (let i = childNodes.length - 1; i >= 0; i--) {
      const child = childNodes[i];
      const sanitized = sanitizeNode(child);
      if (sanitized === null) node.removeChild(child);
    }

    return node;
  };

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

  const positionTooltip = () => {
    if (!activeTooltip || !activeMarker) return;

    const markerRect = activeMarker.getBoundingClientRect();
    const tooltipRect = activeTooltip.getBoundingClientRect();

    const markerCenterX = markerRect.left + markerRect.width * 0.5;
    const markerCenterY = markerRect.top + markerRect.height * 0.5;

    const left = clamp(
      markerCenterX + window.scrollX,
      VIEWPORT_PADDING,
      window.innerWidth - tooltipRect.width - VIEWPORT_PADDING
    );

    activeTooltip.style.left = `${left}px`;

    const desiredTop = markerCenterY + window.scrollY;
    const maxTop = window.scrollY + window.innerHeight - tooltipRect.height - VIEWPORT_PADDING;
    activeTooltip.style.top = `${clamp(desiredTop, VIEWPORT_PADDING + window.scrollY, maxTop)}px`;
  };

  const throttledPositionTooltip = throttleRAF(positionTooltip);

  const closeTooltip = () => {
    if (!activeTooltip) return;

    const tooltip = activeTooltip;
    const marker = activeMarker;

    activeTooltip = null;
    activeMarker = null;

    if (marker) {
      marker.classList.remove('active');
      marker.setAttribute('aria-expanded', 'false');
    }

    cleanupController?.abort();
    cleanupController = null;

    tooltip.classList.remove('visible');

    const handleTransitionEnd = () => {
      if (tooltip.parentNode) setTimeout(() => tooltip.remove(), 300);
    };

    tooltip.addEventListener('transitionend', handleTransitionEnd, { once: true });

    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.removeEventListener('transitionend', handleTransitionEnd);
        tooltip.remove();
      }
    }, 300);
  };

  const showTooltip = (marker) => {
    const tooltip = document.createElement('div');
    tooltip.className = 'code-annotation-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('tabindex', '0');

    const annotationId = marker.dataset.annotationId;
    if (!annotationId || typeof annotationId !== 'string') {
      console.warn('Code annotation marker missing valid data-annotation-id');
      return;
    }

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

    const fragment = document.createDocumentFragment();
    const clonedContent = templateContent.cloneNode(true);
    const childNodes = clonedContent.childNodes;

    for (let i = childNodes.length - 1; i >= 0; i--) {
      const node = childNodes[i];
      if (node.nodeName === 'SCRIPT') {
        node.remove();
      } else {
        const sanitized = sanitizeNode(node);
        if (sanitized === null) node.remove();
      }
    }

    while (clonedContent.firstChild) {
      fragment.appendChild(clonedContent.firstChild);
    }
    tooltip.appendChild(fragment);

    document.body.appendChild(tooltip);
    marker.classList.add('active');
    marker.setAttribute('aria-expanded', 'true');

    setTimeout(() => tooltip.focus(), 100);

    activeTooltip = tooltip;
    activeMarker = marker;

    cleanupController = new AbortController();
    const { signal } = cleanupController;

    window.addEventListener('scroll', throttledPositionTooltip, { capture: true, passive: true, signal });
    window.addEventListener('resize', throttledPositionTooltip, { passive: true, signal });

    positionTooltip();
    requestAnimationFrame(() => tooltip.classList.add('visible'));
  };

  const toggleTooltip = (marker) => {
    if (activeMarker === marker) {
      closeTooltip();
    } else {
      closeTooltip();
      showTooltip(marker);
    }
  };

  const handleClick = (event) => {
    const marker = event.target.closest('.code-annotation-marker');

    if (marker) {
      event.preventDefault();
      toggleTooltip(marker);
    } else if (activeTooltip && !event.target.closest('.code-annotation-tooltip')) {
      closeTooltip();
    }
  };

  const handleKeydown = (event) => {
    if (event.key === 'Escape' && activeTooltip) {
      const markerToFocus = activeMarker;
      closeTooltip();
      if (markerToFocus) markerToFocus.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') &&
               event.target.matches('.code-annotation-marker')) {
      event.preventDefault();
      toggleTooltip(event.target);
    }
  };

  const setupAnnotationBlock = (block) => {
    const annotationsList = block.nextElementSibling;
    if (!annotationsList?.matches('ol')) return;

    const annotations = annotationsList.querySelectorAll('li');
    if (annotations.length === 0) return;

    annotationsList.style.display = 'none';

    const preElement = block.querySelector('pre');
    if (!preElement) return;

    const templateParts = [];

    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        const matches = [];
        MARKER_PATTERN.lastIndex = 0;
        let match;

        while ((match = MARKER_PATTERN.exec(text)) !== null) {
          const annotationIndex = parseInt(match[1], 10) - 1;

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

        if (matches.length > 0) {
          const fragment = document.createDocumentFragment();
          let lastIndex = 0;

          matches.forEach(matchInfo => {
            annotationCounter++;
            const annotationId = `code-annotation-${annotationCounter}`;
            const safeId = annotationId.replace(/[^a-zA-Z0-9\-_]/g, '');
            const safeAnnotationNum = escapeHtml(String(matchInfo.annotationIndex + 1));

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = matchInfo.annotation.innerHTML;

            const scripts = tempDiv.querySelectorAll('script');
            for (let i = 0; i < scripts.length; i++) {
              scripts[i].remove();
            }

            const childNodes = tempDiv.childNodes;
            for (let i = childNodes.length - 1; i >= 0; i--) {
              const childNode = childNodes[i];
              const sanitized = sanitizeNode(childNode);
              if (sanitized === null) tempDiv.removeChild(childNode);
            }

            if (matchInfo.index > lastIndex) {
              fragment.appendChild(
                document.createTextNode(text.substring(lastIndex, matchInfo.index))
              );
            }

            const button = document.createElement('button');
            button.className = 'code-annotation-marker';
            button.type = 'button';
            button.dataset.annotationId = safeId;
            button.setAttribute('aria-label', `Show annotation ${safeAnnotationNum}`);
            button.setAttribute('aria-expanded', 'false');
            button.innerHTML = ICON_SVG;
            fragment.appendChild(button);

            templateParts.push(`<template id="${safeId}">${tempDiv.innerHTML}</template>`);

            lastIndex = matchInfo.index + matchInfo.length;
          });

          if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
          }

          node.parentNode.replaceChild(fragment, node);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const children = Array.from(node.childNodes);
        children.forEach(child => processNode(child));
      }
    };

    processNode(preElement);

    if (templateParts.length > 0) {
      const fragment = document.createDocumentFragment();
      const templatesContainer = document.createElement('div');
      templatesContainer.innerHTML = templateParts.join('');

      while (templatesContainer.firstChild) {
        fragment.appendChild(templatesContainer.firstChild);
      }

      if (preElement.nextSibling) {
        preElement.parentNode.insertBefore(fragment, preElement.nextSibling);
      } else {
        preElement.parentNode.appendChild(fragment);
      }
    }
  };

  const setupLazyLoading = () => {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.annotate.highlight').forEach(setupAnnotationBlock);
      return;
    }

    intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const block = entry.target;
          setupAnnotationBlock(block);
          intersectionObserver.unobserve(block);
        }
      });
    }, {
      rootMargin: '50px'
    });

    document.querySelectorAll('.annotate.highlight').forEach(block => {
      intersectionObserver.observe(block);
    });
  };

  const cleanup = () => {
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }

    if (activeTooltip) closeTooltip();
  };

  const initialize = () => {
    if (isInitialized) {
      console.warn('Code annotation handler already initialized');
      return;
    }

    if (USE_LAZY_LOADING) {
      setupLazyLoading();
    } else {
      const blocks = document.querySelectorAll('.annotate.highlight');
      blocks.forEach(setupAnnotationBlock);
    }

    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('beforeunload', cleanup);

    isInitialized = true;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
