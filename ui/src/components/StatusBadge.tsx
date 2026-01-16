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
import React from "react";

import { type TaskStatusType, type WorkflowStatusType } from "~/models";

import { OutlinedIcon } from "./Icon";
import { Colors, Tag, TagSizes } from "./Tag";

interface BadgeProps {
  iconName: string;
  bgColor: Colors;
}

// Default component to render an icon and a status for workflow-related status messages
const statusConfig: Record<string, BadgeProps> = {
  COMPLETED: { bgColor: Colors.completed, iconName: "check" },
  FAILED: { bgColor: Colors.error, iconName: "close" },
  PENDING: { bgColor: Colors.pending, iconName: "timer" },
  RUNNING: { bgColor: Colors.running, iconName: "av_timer" },
  INITIALIZING: { bgColor: Colors.pending, iconName: "timer" },
  PROCESSING: { bgColor: Colors.pending, iconName: "timer" },
  SUBMITTING: { bgColor: Colors.pending, iconName: "timer" },
  SCHEDULING: { bgColor: Colors.pending, iconName: "timer" },
  WAITING: { bgColor: Colors.pending, iconName: "timer" },
  RESCHEDULED: { bgColor: Colors.error, iconName: "timer" },
  DEFAULT: { bgColor: Colors.tag, iconName: "close" },
};

const getStatusConfig = (status: TaskStatusType | WorkflowStatusType): BadgeProps => {
  const config = status.startsWith("FAILED") ? statusConfig.FAILED : statusConfig[status];
  return config ?? statusConfig.DEFAULT!;
};

interface StatusBadgeProps {
  status: TaskStatusType | WorkflowStatusType;
  className?: string;
  compact?: boolean;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = "", compact = false }) => {
  const { bgColor, iconName } = getStatusConfig(status);

  return (
    <Tag
      color={bgColor}
      reverseColors={true}
      rounded={true}
      size={TagSizes.xs}
      className={`font-semibold ${className} ${compact ? "px-1! min-h-5" : ""}`}
    >
      <OutlinedIcon
        name={iconName}
        className="text-xs!"
      />
      {!compact && status}
    </Tag>
  );
};

export default StatusBadge;
