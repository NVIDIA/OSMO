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
import { memo } from "react";

import { Handle, type NodeProps, Position } from "reactflow";

import StatusBadge from "~/components/StatusBadge";
import { type Group, type Task } from "~/models";

const TASK_NAME_TRUNCATION_LIMIT = 15;

export const truncateTaskName = (name: string) => {
  return name.length > TASK_NAME_TRUNCATION_LIMIT ? `${name.slice(0, TASK_NAME_TRUNCATION_LIMIT - 3)}...` : name;
};

export interface GroupNodeProps extends Group {
  // For displaying handles
  orderIndex: number;
  orderArrayLength: number;
}

export interface TaskNodeProps extends Task {
  selected?: boolean;
}

// ... Node to link to the tasks table once there are too many nodes in the group
export const GraphEllipsisTaskNode = () => {
  return <div className="text-3xl ml-3">...</div>;
};

export const GraphTaskNode = ({ data }: NodeProps<TaskNodeProps>) => {
  return (
    <>
      <div className={`react-flow__node-text`}>{data.name}</div>
      <StatusBadge
        className="react-flow__node-badge"
        status={data.status}
        compact={true}
      />
    </>
  );
};

export const GraphGroupNode = ({ data }: NodeProps<GroupNodeProps>) => {
  // Left-right handles only display in the group nodes if they're not on the edges of the graph
  return (
    <>
      {data.orderIndex != 0 && (
        <Handle
          type="target"
          position={Position.Left}
        />
      )}
      {data.orderArrayLength - 1 != data.orderIndex && (
        <Handle
          type="source"
          position={Position.Right}
        />
      )}
    </>
  );
};

export default memo(GraphGroupNode);
