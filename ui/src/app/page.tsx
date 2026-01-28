//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
"use client";

import { useEffect, useState } from "react";

import { UsedFreeToggle } from "~/app/pools/components/UsedFreeToggle";
import { ResourcesGraph } from "~/app/resources/components/ResourceGraph";
import { TaskPieChart } from "~/components/TaskPieChart";
import { WorkflowPieChart } from "~/components/WorkflowPieChart";
import { api } from "~/trpc/react";

const mockTaskCounts = {
  COMPLETED: 64,
  RUNNING: 12,
  WAITING: 8,
  PROCESSING: 6,
  INITIALIZING: 4,
  FAILED: 3,
  FAILED_EXEC_TIMEOUT: 2,
  FAILED_QUEUE_TIMEOUT: 1,
};

const mockAggregateResources = {
  cpu: { allocatable: 400, usage: 380 },
  memory: { allocatable: 1024, usage: 849 },
  gpu: { allocatable: 8, usage: 4 },
  storage: { allocatable: 2000, usage: 640 },
};

const mockMessagePool = [
  "Workflow alpha-vision queued for GPU pool.",
  "Robot RX-17 completed inspection task.",
  "Workflow data-sync running on pool cpu-large.",
  "Robot TX-02 awaiting task assignment.",
  "Workflow render-frames completed successfully.",
  "Robot QA-05 reported low battery.",
  "Workflow ingest-logs failed with timeout.",
];

export default function Home() {
  const [isShowingUsed, setIsShowingUsed] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const { data: workflowStatusTotals } = api.workflows.getStatusTotals.useQuery({
    all_users: true,
    all_pools: true,
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextIndex = (messageIndex + 1) % mockMessagePool.length;
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setMessages((prev) => [...prev, `[${timestamp}] ${mockMessagePool[messageIndex]}`]);
      setMessageIndex(nextIndex);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [messageIndex]);

  return (
    <div className="grid grid-cols-3 grid-rows-[auto_1fr] gap-global p-global w-full h-full overflow-hidden">
      <div className="card">
        <h2 className="bg-headerbg p-global">Workflows</h2>
        <WorkflowPieChart
          counts={workflowStatusTotals ?? {}}
          size={160}
          innerRadius={40}
          ariaLabel="Workflow status distribution"
        />
      </div>
      <div className="card">
        <h2 className="bg-headerbg p-global">Tasks</h2>
        <TaskPieChart
          counts={mockTaskCounts}
          size={160}
          innerRadius={40}
          ariaLabel="Mock task status distribution"
        />
      </div>
      <div className="card">
        <div className="bg-headerbg px-global flex items-center justify-between gap-2">
          <h2>Isaac-Hil</h2>
          <UsedFreeToggle
            isShowingUsed={isShowingUsed}
            updateUrl={(props) => {
              setIsShowingUsed(props.isShowingUsed ?? true);
            }}
          />
        </div>
        <ResourcesGraph
          {...mockAggregateResources}
          isLoading={false}
          isShowingUsed={isShowingUsed}
        />
      </div>
      <div className="card col-span-3 h-full min-h-0 flex flex-col">
        <h2 className="bg-headerbg p-global">Messages</h2>
        <div className="flex-1 w-full p-global overflow-auto">
          {messages.map((message, index) => (
            <div
              key={index}
              className="text-sm text-gray-500"
            >
              {message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
