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
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { useSearchParams } from "next/navigation";

import { ResourceDetails } from "~/app/resources/components/ResourceDetails";
import FullPageModal from "~/components/FullPageModal";
import { Spinner } from "~/components/Spinner";
import { TaskHistoryBanner } from "~/components/TaskHistoryBanner";
import { type Task } from "~/models";
import { type WorkflowResponse } from "~/models/workflows-model";

import { CancelWorkflow } from "./CancelWorkflow";
import FullPageModalHeading from "./FullPageModalHeading";
import LogPopupHeader from "./LogPopupHeader";
import { PortForward } from "./PortForward";
import { ShellPicker } from "./ShellPicker";
import SpecViewer from "./SpecViewer";
import { PARAM_KEYS, ToolType, type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

// Import SyntaxHighlighter only on the client side to avoid SSR issues
let SyntaxHighlighter: any, json: any;

// Use dynamic imports to prevent SSR issues
const loadSyntaxHighlighter = async () => {
  if (typeof window !== "undefined") {
    try {
      const syntaxHighlighter = await import("react-syntax-highlighter");
      SyntaxHighlighter = syntaxHighlighter.Light;
      json = await import("react-syntax-highlighter/dist/esm/languages/hljs/json");

      // Register the JSON language only on the client side
      if (SyntaxHighlighter && json) {
        SyntaxHighlighter.registerLanguage("json", json.default);
      }
    } catch (error) {
      console.warn("Failed to load SyntaxHighlighter:", error);
    }
  }
};

interface ToolsModalProps {
  tool?: ToolType;
  workflow?: WorkflowResponse;
  selectedTask?: Task;
  fullLog: boolean;
  lines: number;
  verbose?: boolean;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}

export const ToolsModal = ({ tool, workflow, selectedTask, fullLog, lines, verbose, updateUrl }: ToolsModalProps) => {
  const [toolUrl, setToolUrl] = useState<string | undefined>(undefined);
  const [workflowSpec, setWorkflowSpec] = useState<string | undefined>(undefined);
  const ExecTerminal = lazy(() => import("../components/ExecTerminal"));
  const urlParams = useSearchParams();
  const entryCommand = urlParams.get(PARAM_KEYS.entry_command) ?? "/bin/bash";

  // Load SyntaxHighlighter when the component mounts
  useEffect(() => {
    void loadSyntaxHighlighter();
  }, []);

  const execShell = useMemo(() => {
    return tool === ToolType.Shell && selectedTask && workflow?.name ? (
      <Suspense
        fallback={
          <div className="h-full w-full flex items-center justify-center">
            <Spinner />
          </div>
        }
      >
        <ExecTerminal
          workflowName={workflow.name}
          task={selectedTask.name}
          entryCommand={entryCommand}
        />
      </Suspense>
    ) : null;
    // ExecTerminal is not in the dependency array because it is a lazy import - adding it causes a re-render loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selectedTask?.name, workflow?.name, entryCommand]);

  const logUrl = useMemo(() => {
    if (!workflow) {
      return undefined;
    }

    let path: string | null | undefined = undefined;
    switch (tool) {
      case ToolType.TaskLogs:
        path = selectedTask?.logs;
        break;
      case ToolType.TaskEvents:
        path = selectedTask?.events;
        break;
      case ToolType.TaskErrorLogs:
        path = selectedTask?.error_logs;
        break;
      case ToolType.WorkflowLogs:
        path = workflow.logs;
        break;
      case ToolType.WorkflowEvents:
        path = workflow.events;
        break;
      case ToolType.WorkflowErrorLogs:
        path = workflow.error_logs;
        break;
    }

    if (path) {
      const url = new URL(path);
      const params = url.searchParams;
      params.delete(PARAM_KEYS.last_n_lines);
      if (!fullLog) {
        params.append(PARAM_KEYS.last_n_lines, lines.toString());
      }

      params.delete(PARAM_KEYS.retry_id);
      if (selectedTask?.retry_id !== undefined && selectedTask.retry_id !== null) {
        params.append(PARAM_KEYS.retry_id, selectedTask.retry_id.toString());
      }

      const newUrl = new URL(url.origin + url.pathname);
      newUrl.search = params.toString();

      // Remove the origin from the URL. Use the absolute path to support when
      // the UI is served from a different host than the API hostname.
      return newUrl.toString().substring(newUrl.origin.length);
    }
    return undefined;
  }, [
    workflow,
    tool,
    selectedTask?.logs,
    selectedTask?.events,
    selectedTask?.error_logs,
    selectedTask?.retry_id,
    fullLog,
    lines,
  ]);

  useEffect(() => {
    switch (tool) {
      case ToolType.Spec:
        setToolUrl(workflow?.spec);
        break;
      case ToolType.Template:
        setToolUrl(workflow?.template_spec ?? undefined);
        break;
      case ToolType.Outputs:
        setToolUrl(workflow?.outputs ?? undefined);
        break;
      case ToolType.JSON:
        setToolUrl(workflowSpec);
        break;
      default:
        setToolUrl(logUrl);
    }
  }, [tool, workflow, logUrl, workflowSpec]);

  useEffect(() => {
    try {
      if (workflow?.overview && workflow.name) {
        const url = new URL(workflow.overview);
        setWorkflowSpec(`${url.origin}/api/workflow/${workflow.name}`);
      }
    } catch (e) {
      console.error(e);
    }
  }, [workflow]);

  return (
    <FullPageModal
      size={
        tool === ToolType.ShellPicker || tool === ToolType.PortForwarding || tool === ToolType.Cancel ? "none" : "lg"
      }
      open={!!tool && !!workflow}
      onClose={() => updateUrl({ tool: null })}
      headerChildren={
        <LogPopupHeader href={toolUrl}>
          <FullPageModalHeading
            workflow={workflow}
            tool={tool}
            selectedTask={selectedTask}
            fullLog={fullLog}
            lines={lines}
            verbose={verbose}
            updateUrl={updateUrl}
          />
        </LogPopupHeader>
      }
    >
      {!!logUrl && (
        <SpecViewer
          url={logUrl}
          title="Logs"
        />
      )}
      {tool === ToolType.Spec && workflow && (
        <SpecViewer
          url={workflow.spec}
          title="Spec"
        />
      )}
      {tool === ToolType.Template && workflow && (
        <SpecViewer
          url={workflow.template_spec ?? ""}
          title="Template Spec"
        />
      )}
      {tool === ToolType.Shell && execShell}
      {tool === ToolType.ShellPicker && workflow && (
        <ShellPicker
          workflow={workflow}
          selectedTask={selectedTask?.name}
          entryCommand={entryCommand}
          updateUrl={updateUrl}
        />
      )}
      {tool === ToolType.JSON && workflow && (
        <SpecViewer
          url={workflowSpec}
          title="JSON"
        />
      )}
      {tool === ToolType.Nodes && selectedTask?.node_name && (
        <ResourceDetails node={selectedTask.node_name}>
          <TaskHistoryBanner nodeName={selectedTask.node_name} />
        </ResourceDetails>
      )}
      {tool === ToolType.Outputs && workflow && (
        <SpecViewer
          url={workflow.outputs ?? ""}
          title="Outputs"
        />
      )}
      {tool === ToolType.PortForwarding && workflow && (
        <PortForward
          workflow={workflow}
          selectedTask={selectedTask?.name}
        />
      )}
      {tool === ToolType.Cancel && workflow && (
        <CancelWorkflow
          name={workflow.name}
          updateUrl={updateUrl}
        />
      )}
    </FullPageModal>
  );
};
