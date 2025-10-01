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
import { type HTMLAttributes } from "react";

import { checkExhaustive } from "~/utils/common";

export enum TagSizes {
  xxs = "xxs",
  xs = "xs",
  sm = "sm",
  base = "base",
  lg = "lg",
}

export enum Colors {
  pool = "pool",
  platform = "platform",
  tag = "tag",
  error = "error",
  completed = "completed",
  pending = "pending",
  running = "running",
  neutral = "neutral",
  dataset = "dataset",
  collection = "collection",
}

const getColorMapping = (color: (typeof Colors)[keyof typeof Colors], reverseColors: boolean) => {
  switch (color) {
    case Colors.pool:
    case Colors.running:
      if (reverseColors) {
        return "bg-[var(--color-pool-bg-reversed)] text-[var(--color-pool-text-reversed)] hover:bg-[var(--color-pool-bg-reversed)] hover:text-[var(--color-pool-text-reversed)] border-[var(--color-pool-bg-reversed)]";
      } else {
        return "bg-[var(--color-pool-bg)] text-[var(--color-pool-text)] hover:bg-[var(--color-pool-bg)] hover:text-[var(--color-pool-text)] border-[var(--color-pool-text)]";
      }
    case Colors.platform:
      return "bg-[var(--color-platform-bg)] text-[var(--color-platform-text)] hover:bg-[var(--color-platform-bg)] hover:text-[var(--color-platform-text)] border-[var(--color-platform-text)]";
    case Colors.dataset:
      return "bg-[var(--color-dataset-bg)] text-[var(--color-dataset-text)] hover:bg-[var(--color-dataset-bg)] hover:text-[var(--color-dataset-text)] border-[var(--color-dataset-text)]";
    case Colors.collection:
      return "bg-[var(--color-collection-bg)] text-[var(--color-collection-text)] hover:bg-[var(--color-collection-bg)] hover:text-[var(--color-collection-text)] border-[var(--color-collection-text)]";
    case Colors.tag:
      return "bg-[var(--color-tag-bg)] text-[var(--color-tag-text)] hover:bg-[var(--color-tag-bg)] hover:text-[var(--color-tag-text)] border-[var(--color-tag-text)]";
    case Colors.completed:
      return "bg-[var(--color-tag-bg-completed)] text-[var(--color-tag-text-completed)] hover:bg-[var(--color-tag-bg-completed)] hover:text-[var(--color-tag-text-completed)] border-[var(--color-tag-bg-completed)]";
    case Colors.error:
      if (reverseColors) {
        return "bg-[var(--color-error-bg-reversed)] text-[var(--color-error-text-reversed)] hover:bg-[var(--color-error-bg-reversed)] hover:text-[var(--color-error-text-reversed)] border-[var(--color-error-bg-reversed)]";
      } else {
        return "bg-[var(--color-error-bg)] text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] hover:text-[var(--color-error-text)] border-[var(--color-error-text)";
      }
    case Colors.pending:
      return "bg-[var(--color-pending-bg-reversed)] text-[var(--color-pending-text)] hover:bg-[var(--color-pending-bg)] hover:text-[var(--color-pending-text)] border-[var(--color-pending-text)]";
    case Colors.neutral:
      if (reverseColors) {
        return "bg-[var(--color-neutral-bg-reversed)] text-[var(--color-neutral-text-reversed)] hover:bg-[var(--color-neutral-bg-reversed)] hover:text-[var(--color-neutral-text-reversed)] border-[var(--color-neutral-bg-reversed)]";
      } else {
        return "bg-[var(--color-neutral-bg)] text-[var(--color-neutral-text)] hover:bg-[var(--color-neutral-bg)] hover:text-[var(--color-neutral-text)] border-[var(--color-neutral-text)]";
      }
    default:
      checkExhaustive(color);
      return "";
  }
};

interface TagProps extends HTMLAttributes<HTMLDivElement> {
  color?: Colors;
  size?: TagSizes;
  rounded?: boolean;
  reverseColors?: boolean;
}

export const Tag = ({
  className = "",
  color = Colors.pool,
  size = TagSizes.xs,
  rounded = false,
  reverseColors = false,
  ...props
}: TagProps & HTMLAttributes<HTMLDivElement>) => {
  const colorMapping = getColorMapping(color, reverseColors);
  const sizeMapping = `text-${size} rounded-${rounded ? "full" : "md"}`;

  return (
    <div
      className={`${colorMapping} border-1 text-center flex flex-row items-center gap-1 ${sizeMapping} py-0 px-2 ${className}`}
      {...props}
    >
      {props.children}
    </div>
  );
};

export const DatasetTag = ({ isCollection, ...props }: { isCollection: boolean } & TagProps) => {
  return (
    <Tag
      color={isCollection ? Colors.collection : Colors.dataset}
      className="break-all"
      {...props}
    >
      {props.children}
    </Tag>
  );
};
