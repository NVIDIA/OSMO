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

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Spinner } from "~/components/Spinner";
import { Switch } from "~/components/Switch";
import { TextInput } from "~/components/TextInput";
import { CancelWorkflowResponseSchema, OSMOErrorResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { type ToolParamUpdaterProps } from "../hooks/useToolParamUpdater";

export const CancelWorkflow = ({
  name,
  updateUrl,
}: {
  name: string;
  updateUrl: (params: ToolParamUpdaterProps) => void;
}) => {
  const mutation = api.workflows.cancel.useMutation();
  const utils = api.useContext().workflows;
  const [message, setMessage] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleCancelWorkflow = async () => {
    setShowSuccess(false);
    setError(null);

    await mutation.mutateAsync(
      {
        name: name,
        message: message?.trim().length ? message?.trim() : undefined,
        force: force,
      },
      {
        onSuccess: (response) => {
          try {
            CancelWorkflowResponseSchema.parse(response);
            void utils.invalidate();
            setShowSuccess(true);
          } catch {
            const parsedResponse = OSMOErrorResponseSchema.parse(response);
            setError(parsedResponse.message ?? "We couldn't cancel your workflow");
          }
        },
      },
    );
  };

  return (
    <div className="w-full h-full flex flex-col justify-between">
      <div className="flex flex-col gap-global p-global">
        <p>
          Are you sure you want to cancel workflow <strong>{name}</strong>?
        </p>
        <TextInput
          className="w-full"
          id="reason"
          label="Reason (optional)"
          value={message}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMessage(e.target.value)}
          disabled={showSuccess || !!error}
        />
        <Switch
          id="force-cancel"
          className="w-full whitespace-nowrap"
          size="small"
          label="Force Cancel"
          checked={force}
          onChange={setForce}
          disabled={showSuccess || !!error}
        />
      </div>
      <div className="flex flex-col w-full h-full">
        <InlineBanner status={showSuccess ? "success" : error ? "error" : "none"}>
          {showSuccess ? (
            "Workflow canceled"
          ) : error ? (
            <div className="flex flex-col">
              <p>Error canceling workflow</p>
              <p>{error}</p>
            </div>
          ) : (
            ""
          )}
        </InlineBanner>
        <div className="modal-footer">
          {!showSuccess && !error && (
            <button
              className="btn btn-secondary"
              onClick={() => updateUrl({ tool: null })}
            >
              <OutlinedIcon name="close" />
              No
            </button>
          )}
          <button
            className="btn btn-primary h-8"
            onClick={showSuccess || error ? () => updateUrl({ tool: null }) : handleCancelWorkflow}
          >
            {showSuccess || error ? (
              "Close"
            ) : (
              <>
                {mutation.isLoading ? (
                  <Spinner
                    className="border-black"
                    size="button"
                  />
                ) : (
                  <OutlinedIcon name="check" />
                )}
                Yes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
