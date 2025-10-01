//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import { SmartBezierEdge } from "@tisoap/react-flow-smart-edge";
import ReactFlow, {
  ControlButton,
  Controls,
  type Edge,
  MarkerType,
  type Node as RFNode,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";

import { FilledIcon } from "~/components/Icon";
import { type Group, type Task, type WorkflowResponse } from "~/models";

import {
  GraphEllipsisTaskNode,
  GraphGroupNode,
  GraphTaskNode,
  type GroupNodeProps,
  type TaskNodeProps,
} from "./DAGNode";
import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

interface GraphProps {
  workflow: WorkflowResponse;
  refetch?: () => void;
  selectedTask?: Task;
  visible: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}

const nodeTypes = {
  group: GraphGroupNode,
  ellipsis: GraphEllipsisTaskNode,
  input: GraphTaskNode,
};
// Custom edge type for smart routing
const edgeTypes = { smart: SmartBezierEdge };

/**
 * Grouped topological sorting. Group orders are arrays of arrays.
 * Groups within the same array have the same dependency order and can be executed in parallel */
const getTopologicalSort = (groups: Group[]) => {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  groups.forEach((group) => {
    inDegree.set(group.name, 0);
    adjList.set(group.name, []);
  });

  groups.forEach((group) => {
    group.downstream_groups.forEach((downstreamGroup) => {
      inDegree.set(downstreamGroup as string, (inDegree.get(downstreamGroup as string) ?? 0) + 1);
      adjList.get(group.name)?.push(downstreamGroup as string);
    });
  });

  const zeroInDegreeQueue: string[] = [];
  inDegree.forEach((degree, name) => {
    if (degree === 0) {
      zeroInDegreeQueue.push(name);
    }
  });

  const groupedTopologicalOrder: string[][] = [];

  while (zeroInDegreeQueue.length > 0) {
    const currentGroupLevel: string[] = [...zeroInDegreeQueue];
    zeroInDegreeQueue.length = 0;

    currentGroupLevel.forEach((currentGroup) => {
      adjList.get(currentGroup)?.forEach((downstreamGroup) => {
        inDegree.set(downstreamGroup, (inDegree.get(downstreamGroup) ?? 0) - 1);
        if (inDegree.get(downstreamGroup) === 0) {
          zeroInDegreeQueue.push(downstreamGroup);
        }
      });
    });

    groupedTopologicalOrder.push(currentGroupLevel);
  }

  // Return groups sorted by their dependencies
  return groupedTopologicalOrder;
};

const generateNodes = (groups: Group[], order: string[][], selectedTask?: Task): RFNode[] => {
  const groupNodes: RFNode<GroupNodeProps, "group">[] = [];
  const taskNodes: RFNode<Task>[] = [];

  order.forEach((groupNames, orderIndex) => {
    groupNames.forEach((groupName, groupIndex) => {
      // Creating outer group nodes
      const group: Group = groups.find((g) => g.name === groupName)!;
      const groupId = `group-${group.name}`;
      const groupNode: RFNode<GroupNodeProps, "group"> = {
        id: groupId,
        type: "group",
        data: {
          orderArrayLength: order.length,
          orderIndex: orderIndex,
          ...group,
        },
        position: { x: orderIndex * 200, y: groupIndex * 150 },
        style: {
          width: 170,
          height: Math.min(85 * 7 + 30, 85 * group.tasks.length),
          border: `1px dashed black`,
          backgroundColor: "transparent",
        },
        ariaLabel: `Group ${groupName}`,
      };
      groupNodes.push(groupNode);

      // Creating all task nodes inside each group
      const tasksToShow = group.tasks.slice(0, 6);
      tasksToShow.forEach((task: Task, taskIndex) => {
        const taskId = `task-${groupName}-${task.name}-${task.retry_id}`;
        const taskNode: RFNode<TaskNodeProps> = {
          id: taskId,
          data: {
            ...task,
            selected: selectedTask?.name === task.name,
          },
          position: { x: 10, y: 10 + taskIndex * 85 },
          parentId: groupId,
          extent: "parent",
          type: "input",
          selected: selectedTask?.name === task.name && selectedTask?.retry_id === task.retry_id,
        };
        taskNodes.push(taskNode);
      });

      // We don't want to show more than 7 nodes in the same group vertically
      if (group.tasks.length > 7) {
        const ellipsisNode: RFNode = {
          id: `ellipsis-${groupName}`,
          data: {},
          position: { x: 65, y: 70 + 5 * 85 },
          parentId: groupId,
          extent: "parent",
          type: "ellipsis",
        };
        taskNodes.push(ellipsisNode);

        const lastTask = group.tasks[group.tasks.length - 1];
        const lastTaskNode: RFNode<TaskNodeProps> = {
          id: `task-${groupName}-${lastTask!.name}`,
          data: {
            ...lastTask!,
            selected: selectedTask?.name === lastTask!.name && selectedTask?.retry_id === lastTask!.retry_id,
          },
          position: { x: 10, y: 40 + 6 * 85 },
          parentId: groupId,
          extent: "parent",
          type: "input",
          selected: selectedTask?.name === lastTask!.name,
        };
        taskNodes.push(lastTaskNode);
      }
    });
  });

  return [...(groupNodes ?? null), ...(taskNodes ?? null)];
};

const generateEdges = (groups: Group[]): Edge[] => {
  const edges: Edge[] = [];
  groups.forEach((group) => {
    const groupId = `group-${group.name}`;

    group.downstream_groups.forEach((downstreamGroup) => {
      const targetGroup = groups.find((g) => g.name === downstreamGroup);
      if (targetGroup) {
        const targetGroupId = `group-${targetGroup.name}`;
        const edge: Edge = {
          id: `e-${groupId}-${targetGroupId}`,
          source: groupId,
          target: targetGroupId,
          type: "smart",
          markerEnd: {
            type: MarkerType.Arrow,
          },
          animated: targetGroup.tasks.some((task) =>
            ["SUBMITTING", "WAITING", "PROCESSING", "SCHEDULING", "INITIALIZING", "RUNNING", "RESCHEDULED"].includes(
              task.status,
            ),
          ),
        };
        edges.push(edge);
      }
    });
  });

  return edges;
};

const DirectedAcyclicGraph: React.FC<GraphProps> = ({
  workflow,
  refetch,
  selectedTask,
  visible,
  updateUrl,
}: GraphProps) => {
  const reactFlow = useReactFlow();
  const nodes = useMemo<RFNode[]>(
    () => generateNodes(workflow.groups, getTopologicalSort(workflow.groups), selectedTask),
    [workflow.groups, selectedTask],
  );
  const edges = useMemo<Edge[]>(() => generateEdges(workflow.groups), [workflow.groups]);
  const firstRender = useRef(true);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: RFNode<TaskNodeProps>) => {
      if (node.type === "input") {
        updateUrl({
          task: node.data.name,
          retry_id: node.data.retry_id,
        });
      }
    },
    [updateUrl],
  );

  const fitView = useCallback(() => {
    reactFlow.fitView();

    const viewport = reactFlow.getViewport();
    if (viewport.y < 0) {
      reactFlow.setViewport({ x: viewport.x, y: 0, zoom: 0.5 });
    }
  }, [reactFlow]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (visible && firstRender.current) {
      timeout = setTimeout(() => {
        // Sometimes the fitView doesn't work on initial load, so we wait a bit before calling it
        firstRender.current = false;
        fitView();
      }, 100);
    }

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [fitView, visible]);

  if (!nodes.length) {
    return null;
  }

  return (
    <ReactFlow
      fitView
      nodesDraggable={false}
      preventScrolling={true}
      elementsSelectable={true}
      panOnDrag={true}
      panOnScroll={true}
      elevateNodesOnSelect={true}
      nodesConnectable={false}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      zoomOnDoubleClick={false}
      zoomOnScroll={false}
      onNodeClick={onNodeClick}
    >
      <Controls
        showFitView={true}
        onFitView={fitView}
        position={"top-right"}
        showInteractive={false}
      >
        {refetch && (
          <ControlButton
            onClick={() => refetch()}
            title="Refresh"
          >
            <FilledIcon name="refresh" />
          </ControlButton>
        )}
      </Controls>
    </ReactFlow>
  );
};

export default DirectedAcyclicGraph;
