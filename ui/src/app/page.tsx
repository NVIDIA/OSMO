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

import Link from "next/link";

import { UsedFreeToggle } from "~/app/pools/components/UsedFreeToggle";
import { ResourcesGraph } from "~/app/resources/components/ResourceGraph";
import { useAuth } from "~/components/AuthProvider";
import { getDateFromValues } from "~/components/DateRangePicker";
import { OutlinedIcon } from "~/components/Icon";
import PageHeader from "~/components/PageHeader";
import { StatusFilterType } from "~/components/StatusFilter";
import { TaskPieChart } from "~/components/TaskPieChart";
import { WorkflowPieChart } from "~/components/WorkflowPieChart";
import { env } from "~/env.mjs";
import { type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import { getTaskStatusArray } from "./tasks/components/StatusFilter";
import { getWorkflowStatusArray } from "./workflows/components/StatusFilter";

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
  const currentDays = 365;
  const { username } = useAuth();
  const [isShowingUsed, setIsShowingUsed] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [messageIndex, setMessageIndex] = useState(0);
  const todayDateRange = getDateFromValues(currentDays);

  const { data: currentWorkflows } = api.workflows.getStatusTotals.useQuery({
    all_users: false,
    all_pools: true,
    users: [username],
    statuses: getWorkflowStatusArray(StatusFilterType.CURRENT),
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const { data: todaysWorkflows } = api.workflows.getStatusTotals.useQuery({
    all_users: false,
    all_pools: true,
    users: [username],
    submitted_after: todayDateRange.fromDate?.toISOString(),
    submitted_before: todayDateRange.toDate?.toISOString(),
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const { data: todaysTasks } = api.tasks.getStatusTotals.useQuery({
    all_users: false,
    all_pools: true,
    users: [username],
    started_after: todayDateRange.fromDate?.toISOString(),
    started_before: todayDateRange.toDate?.toISOString(),
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const { data: currentTasks } = api.tasks.getStatusTotals.useQuery({
    all_users: false,
    all_pools: true,
    users: [username],
    statuses: getTaskStatusArray(StatusFilterType.CURRENT),
  }, {
    refetchOnWindowFocus: true,
    refetchInterval: (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
  });

  const { data: profile } = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
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
    <>
      <PageHeader />
      <div className="flex justify-center h-full w-full overflow-hidden">
        <div className="grid grid-cols-4 grid-rows-[auto_1fr] gap-global p-global h-full max-w-400 overflow-hidden">
          <section className="card" aria-labelledby="current-workflows-title">
            <div className="popup-header body-header">
              <h2 id="current-workflows-title">Current Workflows</h2>
              <Link
                href={`/workflows?allUsers=false&allPools=true&users=${encodeURIComponent(username)}&dateRange=-2&statusType=current`}
                className="btn btn-secondary" title="View All Current Workflows">
                <OutlinedIcon name="more_horiz" />
              </Link>
            </div>
            <div className="p-global">
              <WorkflowPieChart
                counts={currentWorkflows ?? {}}
                size={160}
                innerRadius={40}
                ariaLabel="My Current Workflows"
              />
            </div>
          </section>
          <section className="card" aria-labelledby="todays-workflows-title">
            <div className="popup-header body-header">
              <h2 id="todays-workflows-title">Today&apos;s Workflows</h2>
              <Link href={`/workflows?allUsers=false&allPools=true&users=${encodeURIComponent(username)}&dateRange=${currentDays}`} className="btn btn-secondary" title="View All Today&apos;s Workflows">
                <OutlinedIcon name="more_horiz" />
              </Link>
            </div>
            <div className="p-global">
              <WorkflowPieChart
                counts={todaysWorkflows ?? {}}
                size={160}
                innerRadius={40}
                ariaLabel="Today&apos;s Workflows"
              />
            </div>
          </section>
          <section className="card" aria-labelledby="current-tasks-title">
            <div className="popup-header body-header">
              <h2 id="current-tasks-title">Current Tasks</h2>
              <Link href={`/tasks?allUsers=false&allPools=true&users=${encodeURIComponent(username)}&statusType=current`} className="btn btn-secondary" title="View All Current Tasks">
                <OutlinedIcon name="more_horiz" />
              </Link>
            </div>
            <div className="p-global">
              <TaskPieChart counts={currentTasks ?? {}} size={160} innerRadius={40} ariaLabel="Current Tasks" />
            </div>
          </section>
          <section className="card" aria-labelledby="todays-tasks-title">
            <div className="popup-header body-header">
              <h2 id="todays-tasks-title">Today&apos;s Tasks</h2>
              <Link href={`/tasks?allUsers=false&allPools=true&users=${encodeURIComponent(username)}&dateRange=${currentDays}&statusType=all`} className="btn btn-secondary" title="View All Today&apos;s Tasks">
                <OutlinedIcon name="more_horiz" />
              </Link>
            </div>
            <div className="p-global">
              <TaskPieChart counts={todaysTasks ?? {}} size={160} innerRadius={40} ariaLabel="Today&apos;s Tasks" />
            </div>
          </section>
          <section className="card" aria-labelledby="resources-title">
            <div className="popup-header body-header">
              <h2>{profile?.profile.pool ?? "Default Pool"}</h2>
              {profile?.profile.pool ? (
                <UsedFreeToggle
                  isShowingUsed={isShowingUsed}
                  updateUrl={(props) => {
                    setIsShowingUsed(props.isShowingUsed ?? true);
                  }}
                />
              ) : <Link href="/profile?tool=settings" className="btn btn-secondary" title="Configure Default Pool">Configure</Link>}
            </div>
            <ResourcesGraph
              {...mockAggregateResources}
              isLoading={false}
              isShowingUsed={isShowingUsed}
            />
          </section>
          <section className="card col-span-3 h-full min-h-50 flex flex-col" aria-labelledby="messages-title">
            <div className="popup-header body-header">
              <h2 id="messages-title">Messages</h2>
            </div>
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
          </section>
        </div>
      </div>
    </>
  );
}
