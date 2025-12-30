// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * ReactFlow DAG Visualization Page
 *
 * Workflow DAG visualization using ReactFlow and ELK.js layout.
 *
 * Architecture:
 * - /constants.ts - Dimensions, styling, thresholds
 * - /types.ts - TypeScript types
 * - /components/ - React components (GroupNode, DetailsPanel, etc.)
 * - /layout/ - ELK.js layout logic
 * - /hooks/ - State management (useDAGState, useResizablePanel)
 * - /utils/ - Status helpers, icons
 *
 * Navigation Flow:
 * - Click GROUP node (multi-task) → Opens DetailsPanel with GroupDetails
 * - Click task in GroupDetails → Transitions to TaskDetails (same panel)
 * - Click SINGLE-TASK node → Opens DetailsPanel with TaskDetails directly
 * - Sibling navigation in TaskDetails → Jump between tasks in same group
 */

"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ReactFlow, ReactFlowProvider, Background, MiniMap, BackgroundVariant, PanOnScrollMode, useReactFlow } from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./dag.css";

// Local modules
import type { LayoutDirection, GroupNodeData } from "./types/layout";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  STATUS_STYLES,
  VIEWPORT,
  NODE_COLLAPSED,
  ANIMATION,
  MINIMAP,
  BACKGROUND,
} from "./constants";
import {
  nodeTypes,
  MiniMapNode,
  FitViewOnLayoutChange,
  DAGErrorBoundary,
  DAGHeader,
  DAGToolbar,
  DAGControls,
  DetailsPanel,
} from "./components";
import { useDAGState, useResizablePanel } from "./hooks";
import { getStatusCategory } from "./utils";
import { DAGProvider } from "./context";

// Workflow data
import { EXAMPLE_WORKFLOWS, type WorkflowPattern } from "../mock-workflow-v2";

// ============================================================================
// Main Page Component
// ============================================================================

function ReactFlowDagPageInner() {
  const [workflowPattern, setWorkflowPattern] = useState<WorkflowPattern>("complex");
  const [showMinimap, setShowMinimap] = useState(true);

  // Generate workflow from mock
  const workflow = useMemo(() => EXAMPLE_WORKFLOWS[workflowPattern](), [workflowPattern]);

  // DAG state management (includes panel navigation state)
  const {
    nodes,
    edges,
    layoutDirection,
    setLayoutDirection,
    groupsWithLayout,
    rootNodeIds,
    handleExpandAll,
    handleCollapseAll,
    handleSelectGroup,
    handleSelectTask,
    handleToggleExpand,
    panelView,
    selectedGroup,
    selectedTask,
    handleClosePanel,
    handleBackToGroup,
    nodeBounds,
    isLayouting,
  } = useDAGState({
    groups: workflow.groups,
    initialDirection: "TB",
  });

  // Resizable panel
  const { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef } = useResizablePanel();

  // Determine if panel is open (needed early for dynamic bounds)
  const isPanelOpen = panelView !== "none" && selectedGroup !== null;

  // ReactFlow instance for viewport control
  const reactFlowInstance = useReactFlow();
  
  // Track previous selection to detect new selections vs resizes
  const prevSelectionRef = useRef<string | null>(null);
  
  // Track "desired" viewport position (where user wants to be, ignoring boundaries)
  const desiredViewportRef = useRef<{ x: number; y: number } | null>(null);

  // Get visible area dimensions (call fresh each time, no stale closures)
  const getVisibleArea = useCallback(() => {
    const container = containerRef.current;
    const containerWidth = container?.clientWidth || VIEWPORT.ESTIMATED_WIDTH;
    const containerHeight = container?.clientHeight || VIEWPORT.ESTIMATED_HEIGHT;
    const panelWidthPx = isPanelOpen ? (panelPct / 100) * containerWidth : 0;
    return {
      width: containerWidth - panelWidthPx,
      height: containerHeight,
    };
  }, [isPanelOpen, panelPct]);

  // Calculate viewport bounds - allows any outermost node to be centered
  // These are the allowed ranges for viewport.x and viewport.y
  const getViewportBounds = useCallback((zoom: number, visWidth: number, visHeight: number) => {
    // For a node at worldX to appear at screenX:
    //   screenX = worldX * zoom + viewport.x
    // For rightmost node to be at center of visible area:
    //   viewport.x = visWidth/2 - nodeBounds.maxX * zoom  (minX - can't pan further left)
    // For leftmost node to be at center:
    //   viewport.x = visWidth/2 - nodeBounds.minX * zoom  (maxX - can't pan further right)
    
    const minX = visWidth / 2 - nodeBounds.maxX * zoom;
    const maxX = visWidth / 2 - nodeBounds.minX * zoom;
    const minY = visHeight / 2 - nodeBounds.maxY * zoom;
    const maxY = visHeight / 2 - nodeBounds.minY * zoom;
    
    return { minX, maxX, minY, maxY };
  }, [nodeBounds]);

  // Auto-pan to center node when CLICKING (new selection)
  // Uses requestAnimationFrame to wait for panel to render before calculating visible area
  useEffect(() => {
    if (!selectedGroup || panelView === "none") return;
    
    // Only auto-pan on NEW selection
    const currentSelection = `${selectedGroup.name}-${panelView}`;
    if (prevSelectionRef.current === currentSelection) return;
    prevSelectionRef.current = currentSelection;

    const selectedNode = nodes.find((n) => n.id === selectedGroup.name);
    if (!selectedNode) return;

    // Wait for panel to render before calculating visible area
    // Double rAF ensures layout is complete after panel mounts
    let outerFrameId: number;
    let innerFrameId: number;
    
    outerFrameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        const nodeData = selectedNode.data as GroupNodeData;
        const nodeWidth = nodeData?.nodeWidth || NODE_COLLAPSED.width;
        const nodeHeight = nodeData?.nodeHeight || NODE_COLLAPSED.height;
        const nodeCenterX = selectedNode.position.x + nodeWidth / 2;
        const nodeCenterY = selectedNode.position.y + nodeHeight / 2;
        
        const viewport = reactFlowInstance.getViewport();
        const { width, height } = getVisibleArea();
        
        // Center node in visible area (after panel has expanded)
        const targetX = -(nodeCenterX * viewport.zoom) + width / 2;
        const targetY = -(nodeCenterY * viewport.zoom) + height / 2;
        
        desiredViewportRef.current = { x: targetX, y: targetY };
        
        reactFlowInstance.setViewport(
          { x: targetX, y: targetY, zoom: viewport.zoom },
          { duration: ANIMATION.NODE_CENTER }
        );
      });
    });
    
    return () => {
      cancelAnimationFrame(outerFrameId);
      cancelAnimationFrame(innerFrameId);
    };
  }, [selectedGroup?.name, panelView, nodes, reactFlowInstance, getVisibleArea]);
  
  // Enforce boundaries when visible area changes (panel resize)
  // This runs on every panelPct change
  useEffect(() => {
    const viewport = reactFlowInstance.getViewport();
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);
    
    // Clamp current viewport to bounds
    let newX = viewport.x;
    let newY = viewport.y;
    let needsUpdate = false;
    
    // If we have a desired position, try to get as close to it as bounds allow
    if (desiredViewportRef.current) {
      const desired = desiredViewportRef.current;
      newX = Math.max(bounds.minX, Math.min(bounds.maxX, desired.x));
      newY = Math.max(bounds.minY, Math.min(bounds.maxY, desired.y));
      needsUpdate = Math.abs(newX - viewport.x) > 0.5 || Math.abs(newY - viewport.y) > 0.5;
    } else {
      // No desired position - just clamp to bounds
      newX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
      newY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));
      needsUpdate = newX !== viewport.x || newY !== viewport.y;
    }
    
    if (needsUpdate) {
      reactFlowInstance.setViewport(
        { x: newX, y: newY, zoom: viewport.zoom },
        { duration: ANIMATION.BOUNDARY_ENFORCE }
      );
    }
  }, [panelPct, isPanelOpen, reactFlowInstance, getViewportBounds, getVisibleArea]);
  
  // Clear refs when panel closes
  useEffect(() => {
    if (panelView === "none") {
      prevSelectionRef.current = null;
      desiredViewportRef.current = null;
    }
  }, [panelView]);

  // Enforce viewport bounds during panning (prevents going out of bounds)
  const handleMove = useCallback((_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);
    
    // Check if out of bounds
    const outOfBoundsX = viewport.x < bounds.minX || viewport.x > bounds.maxX;
    const outOfBoundsY = viewport.y < bounds.minY || viewport.y > bounds.maxY;
    
    if (outOfBoundsX || outOfBoundsY) {
      // Clamp immediately (no animation during active panning)
      const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
      const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));
      
      reactFlowInstance.setViewport({ x: clampedX, y: clampedY, zoom: viewport.zoom });
    }
  }, [reactFlowInstance, getVisibleArea, getViewportBounds]);
  
  // Also enforce on move end for final cleanup
  const handleMoveEnd = useCallback(() => {
    const viewport = reactFlowInstance.getViewport();
    const { width, height } = getVisibleArea();
    const bounds = getViewportBounds(viewport.zoom, width, height);
    
    // Clamp viewport to bounds
    const clampedX = Math.max(bounds.minX, Math.min(bounds.maxX, viewport.x));
    const clampedY = Math.max(bounds.minY, Math.min(bounds.maxY, viewport.y));
    
    // Store as desired position so resize respects it
    desiredViewportRef.current = { x: clampedX, y: clampedY };
    
    // Only update if out of bounds
    if (Math.abs(clampedX - viewport.x) > 0.5 || Math.abs(clampedY - viewport.y) > 0.5) {
      reactFlowInstance.setViewport(
        { x: clampedX, y: clampedY, zoom: viewport.zoom },
        { duration: ANIMATION.MOVE_END }
      );
    }
  }, [reactFlowInstance, getVisibleArea, getViewportBounds]);

  // Pattern change handler
  const onPatternChange = useCallback((pattern: WorkflowPattern) => {
    setWorkflowPattern(pattern);
  }, []);

  // Layout direction change handler
  const onLayoutChange = useCallback(
    (direction: LayoutDirection) => {
      setLayoutDirection(direction);
    },
    [setLayoutDirection],
  );

  // Minimap toggle handler
  const handleToggleMinimap = useCallback(() => {
    setShowMinimap((prev) => !prev);
  }, []);

  // MiniMap color callbacks
  const getMiniMapNodeColor = useCallback((node: { data: unknown }) => {
    const data = node.data as GroupNodeData;
    if (!data?.group) return "#52525b";
    const category = getStatusCategory(data.group.status);
    return STATUS_STYLES[category].color;
  }, []);

  const getMiniMapStrokeColor = useCallback((node: { data: unknown }) => {
    const data = node.data as GroupNodeData;
    if (!data?.group) return "#3f3f46";
    const category = getStatusCategory(data.group.status);
    return STATUS_STYLES[category].strokeColor;
  }, []);

  return (
    <DAGErrorBoundary>
      <div className="flex h-full flex-col bg-zinc-950">
        {/* Skip link for accessibility */}
        <a
          href="#dag-canvas"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-zinc-800 focus:px-4 focus:py-2 focus:text-zinc-100"
        >
          Skip to DAG visualization
        </a>

        {/* Header */}
        <DAGHeader
          status={workflow.status}
          duration={workflow.duration}
          groups={groupsWithLayout}
          isLayouting={isLayouting}
          onExpandAll={handleExpandAll}
          onCollapseAll={handleCollapseAll}
        />

        {/* Toolbar - Demo pattern selector */}
        <DAGToolbar
          workflowPattern={workflowPattern}
          onPatternChange={onPatternChange}
        />

        {/* Main Content */}
        <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
          {/* ReactFlow Canvas */}
          <main
            id="dag-canvas"
            className="flex-1"
            role="application"
            aria-label="Workflow DAG visualization"
          >
            <DAGProvider
              onSelectGroup={handleSelectGroup}
              onSelectTask={handleSelectTask}
              onToggleExpand={handleToggleExpand}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                // Read-only DAG
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={true}
                edgesFocusable={false}
                nodesFocusable={true}
                selectNodesOnDrag={false}
                // Viewport settings
                defaultViewport={{ x: 100, y: 50, zoom: DEFAULT_ZOOM }}
                minZoom={nodeBounds.fitAllZoom}
                maxZoom={MAX_ZOOM}
                // Enforce boundaries during and after pan/zoom
                onMove={handleMove}
                onMoveEnd={handleMoveEnd}
                // Scroll behavior
                panOnScroll={true}
                zoomOnScroll={false}
                panOnScrollMode={PanOnScrollMode.Free}
                zoomOnPinch={true}
                preventScrolling={true}
                proOptions={{ hideAttribution: true }}
              >
                <FitViewOnLayoutChange
                  layoutDirection={layoutDirection}
                  rootNodeIds={rootNodeIds}
                />
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={BACKGROUND.GAP}
                  size={BACKGROUND.DOT_SIZE}
                  color={BACKGROUND.COLOR}
                />
                {/* Unified controls panel */}
                <DAGControls
                  layoutDirection={layoutDirection}
                  onLayoutChange={onLayoutChange}
                  showMinimap={showMinimap}
                  onToggleMinimap={handleToggleMinimap}
                />
                {/* Conditional minimap */}
                {showMinimap && (
                  <MiniMap
                    pannable
                    zoomable
                    position="top-left"
                    style={{
                      background: "#18181b",
                      width: MINIMAP.WIDTH,
                      height: MINIMAP.HEIGHT,
                    }}
                    maskColor="rgba(0, 0, 0, 0.6)"
                    nodeStrokeWidth={MINIMAP.NODE_STROKE_WIDTH}
                    nodeComponent={MiniMapNode}
                    nodeColor={getMiniMapNodeColor}
                    nodeStrokeColor={getMiniMapStrokeColor}
                    aria-label="Workflow minimap"
                  />
                )}
              </ReactFlow>
            </DAGProvider>
          </main>

          {/* Unified Details Panel */}
          {isPanelOpen && selectedGroup && (
            <DetailsPanel
              view={panelView as "group" | "task"}
              group={selectedGroup}
              task={selectedTask}
              onClose={handleClosePanel}
              onBackToGroup={handleBackToGroup}
              onSelectTask={handleSelectTask}
              panelPct={panelPct}
              onPanelResize={setPanelPct}
              isDragging={isDragging}
              onResizeMouseDown={handleMouseDown}
            />
          )}
        </div>

        {/* Footer */}
        <footer className="border-t border-zinc-800 bg-zinc-900/50 p-4">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-zinc-400 hover:text-zinc-300">
              🎨 Implementation Notes
            </summary>
            <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
              <li>
                ✅ <strong>Unified DetailsPanel</strong>: Seamless group ↔ task navigation
              </li>
              <li>
                ✅ <strong>ELK.js layout</strong>: Better algorithms, web worker ready
              </li>
              <li>
                ✅ <strong>Virtualized task lists</strong>: Handles 200+ tasks efficiently
              </li>
              <li>
                ✅ <strong>Sibling navigation</strong>: Jump between tasks in same group
              </li>
              <li>
                ✅ <strong>Smart search</strong>: Chip-based filters, NLP time parsing
              </li>
              <li>
                ✅ <strong>WCAG 2.1 AA</strong>: ARIA labels, keyboard nav, reduced motion
              </li>
            </ul>
          </details>
        </footer>
      </div>
    </DAGErrorBoundary>
  );
}

// Wrap with ReactFlowProvider
export default function ReactFlowDagPage() {
  return (
    <ReactFlowProvider>
      <ReactFlowDagPageInner />
    </ReactFlowProvider>
  );
}
