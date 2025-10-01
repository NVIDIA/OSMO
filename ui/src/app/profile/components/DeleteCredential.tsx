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
import { DeleteCredentialsResponseSchema, OSMOErrorResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import useToolParamUpdater from "../hooks/useToolParamUpdater";

export const DeleteCredential = ({ credential, onUpdate }: { credential: string; onUpdate: () => void }) => {
  const mutation = api.credentials.deleteCredential.useMutation();
  const toolParamUpdater = useToolParamUpdater();
  const [error, setError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleDelete = async () => {
    setError(undefined);
    setShowSuccess(false);

    await mutation.mutateAsync(
      {
        cred_name: credential,
      },
      {
        onSuccess: (response) => {
          const result = DeleteCredentialsResponseSchema.safeParse(response);
          if (result.success) {
            setShowSuccess(true);
            onUpdate();
          } else {
            const parsedResponse = OSMOErrorResponseSchema.safeParse(response);
            setError(parsedResponse?.error?.message ?? "An unknown error occurred");
          }
        },
      },
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-3">
        <p>
          Are you sure you want to delete the credential <strong>{credential}</strong>?
        </p>
        <p>This credential cannot be recovered after you delete it.</p>
      </div>
      <InlineBanner status={error ? "error" : showSuccess ? "success" : "none"}>
        {error ? error : showSuccess ? "Credential deleted successfully" : ""}
      </InlineBanner>
      <div className="modal-footer">
        {!showSuccess && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              toolParamUpdater({ tool: null });
            }}
          >
            Cancel
          </button>
        )}
        <button
          className="btn btn-primary h-8"
          onClick={handleDelete}
        >
          {mutation.isLoading ? (
            <Spinner
              className="border-black"
              size="button"
            />
          ) : !showSuccess ? (
            <OutlinedIcon name="delete" />
          ) : null}
          {showSuccess ? "Close" : "Delete"}
        </button>
      </div>
    </div>
  );
};
