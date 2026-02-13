//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";

import { type Dashboard } from "~/app/page";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";

interface ShareDashboardProps {
  open: boolean;
  onClose: () => void;
  dashboard?: Dashboard;
  existingNames: string[];
  existingIDs: string[];
  onImport: (dashboard: Dashboard) => void;
}

const ShareDashboard = ({ open, onClose, dashboard, existingNames, existingIDs, onImport }: ShareDashboardProps) => {
  const [copied, setCopied] = useState(false);
  const [workflowJson, setWorkflowJson] = useState("");
  const [importError, setImportError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setCopied(false);
    setImportError(undefined);
  }, [open]);

  useEffect(() => {
    setWorkflowJson(dashboard ? JSON.stringify(dashboard, null, 2) : "");
  }, [dashboard]);

  return (
    <FullPageModal
      id="share-dashboard"
      open={open}
      onClose={onClose}
      headerChildren={dashboard ? "Share Dashboard" : "Import Dashboard"}
      size="lg"
    >
      <form
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-col"
      >
        <textarea
          id="workflow-json"
          className="w-[95vw] h-[80vh] border-b-1 border-border p-global text-sm"
          value={workflowJson}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setWorkflowJson(event.target.value);
          }}
          spellCheck={false}
        />
        <InlineBanner status={importError ? "error" : copied ? "success" : "none"}>
          <p className="grow">{importError}</p>
          <p className="grow">{copied ? "Copied" : ""}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              if (dashboard) {
                if (!navigator.clipboard) {
                  return;
                }
                await navigator.clipboard.writeText(workflowJson);
                setCopied(true);
              } else {
                try {
                  setImportError(undefined);
                  const dashboard = JSON.parse(workflowJson) as Dashboard;
                  if (existingIDs.includes(dashboard.id)) {
                    setImportError("Dashboard ID already exists");
                    return;
                  }
                  if (existingNames.includes(dashboard.name)) {
                    setImportError("Dashboard name already exists");
                    return;
                  }
                  onImport(dashboard);
                } catch (error) {
                  setImportError("Invalid JSON");
                }
              }
            }}
            title="Copy JSON to clipboard"
          >
            {dashboard ? (
              <>
                <OutlinedIcon name="content_copy" />
                Copy
              </>
            ) : (
              <>
                <OutlinedIcon name="upload_file" />
                Import
              </>
            )}
          </button>
        </InlineBanner>
      </form>
    </FullPageModal>
  );
};

export default ShareDashboard;
