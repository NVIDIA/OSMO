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
import { useState } from "react";

import { InlineBanner } from "~/components/InlineBanner";
import { Select } from "~/components/Select";
import { Spinner } from "~/components/Spinner";
import { TextInput } from "~/components/TextInput";
import {
  type ExecWorkflowResponse,
  ExecWorkflowResponseSchema,
  OSMOErrorResponseSchema,
  type WorkflowResponse,
} from "~/models/workflows-model";
import { api } from "~/trpc/react";
import { updateALBCookies } from "~/utils/auth";

export const PortForward = ({ workflow, selectedTask }: { workflow: WorkflowResponse; selectedTask?: string }) => {
  const [port, setPort] = useState<number | undefined>(undefined);
  const [task, setTask] = useState<string | undefined>(selectedTask ?? workflow.groups[0]?.tasks[0]?.name);
  const [portError, setPortError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const webServerMutation = api.workflows.webServer.useMutation();

  const launchPortForwardingWithRetry = async (meta: ExecWorkflowResponse) => {
    const routerUrl = new URL(meta.router_address);
    const pingUrl = new URL(`https://${routerUrl.host}/api/router/webserver/${meta.key}`);

    updateALBCookies(meta.cookie, routerUrl.host);

    setIsLoading(true);
    try {
      while (true) {
        const response = await fetch(pingUrl);
        const data = (await response.json()) as boolean;

        if (data) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      window.open(`https://${meta.key}.${pingUrl.host}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error");
    }

    setIsLoading(false);
  };

  const portForward = async () => {
    if (port && task) {
      await webServerMutation.mutateAsync(
        {
          name: workflow.name,
          task,
          port,
        },
        {
          onSuccess: (response) => {
            try {
              void launchPortForwardingWithRetry(ExecWorkflowResponseSchema.parse(response));
            } catch {
              const parsedResponse = OSMOErrorResponseSchema.parse(response);
              console.error(parsedResponse);
              setError(parsedResponse.message ?? "Unknown error");
            }
          },
        },
      );
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setError(undefined);
    setPortError(undefined);

    if (!port) {
      setPortError("Port is required");
      return;
    }

    if (!task) {
      return;
    }

    void portForward();
  };

  if (!task) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full">
      {error && <InlineBanner status="error">{error}</InlineBanner>}
      <form onSubmit={handleSubmit}>
        <div className="flex flex-row gap-3 p-3">
          <Select
            id="task"
            value={task}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setTask(e.target.value);
              setError(undefined);
            }}
            label="Task"
          >
            {workflow.groups.map((group) =>
              group.tasks.map((task) => (
                <option
                  key={task.name}
                  value={task.name}
                >
                  {task.name}
                </option>
              )),
            )}
          </Select>
          <TextInput
            id="port"
            label="Port"
            value={port?.toString() ?? ""}
            type="number"
            max={65535}
            min={1}
            className="w-32"
            onChange={(e) => {
              setPort(Number(e.target.value));
              setPortError(undefined);
              setError(undefined);
            }}
            errorText={portError}
          />
          <button
            className="btn btn-primary mt-4 mb-5"
            type="submit"
          >
            Start
          </button>
        </div>
      </form>
      {isLoading && (
        <div className="flex justify-center items-center grow translate-y-[-10%]">
          <Spinner
            size="medium"
            description="Launching Port Forwarding..."
          />
        </div>
      )}
    </div>
  );
};
