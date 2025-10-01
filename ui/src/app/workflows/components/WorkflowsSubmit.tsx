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
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-yaml";
import "prismjs/themes/prism.css";
import Editor from "react-simple-code-editor";
import { useWindowSize } from "usehooks-ts";

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { PageError } from "~/components/PageError";
import { Select } from "~/components/Select";
import { Spinner } from "~/components/Spinner";
import { env } from "~/env.mjs";
import {
  CreateWorkflowResponseSchema,
  OSMOErrorResponseSchema,
  type PriorityType,
  ProfileResponseSchema,
} from "~/models";
import { api } from "~/trpc/react";

// Import Prism.js only on the client side to avoid SSR issues
export const mockCreatedWorkflowFile = `
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

workflow:
  name: hello-osmo
  tasks:
  # Simple Task
  - name: hello
    image: ubuntu:22.04
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    files:
    - path: /tmp/entry.sh
      contents: |
        echo "Hello from ${env.NEXT_PUBLIC_APP_NAME}!"
`;

// TODO: add form validation, `file` MUST BE valid yaml.
export const WorkflowsSubmit = ({
  placeholderFile = mockCreatedWorkflowFile,
  renderedSpec = mockCreatedWorkflowFile,
}: {
  placeholderFile?: string;
  renderedSpec?: string;
}) => {
  const mutation = api.workflows.create.useMutation();
  const { data: profileData, isLoading } = api.profile.getSettings.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const [file, setFile] = useState(placeholderFile);
  const [selectedPool, setSelectedPool] = useState<string | undefined>(undefined);
  const [selectedPriority, setSelectedPriority] = useState<PriorityType>("NORMAL");
  const [error, setError] = useState<string | undefined>(undefined);
  const params = useSearchParams();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const { height: windowHeight } = useWindowSize();
  const [editorHeight, setEditorHeight] = useState(0);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFile(placeholderFile);
  }, [placeholderFile]);

  const parsedProfileData = useMemo(() => {
    if (!profileData) {
      return undefined;
    }
    return ProfileResponseSchema.safeParse(profileData);
  }, [profileData]);

  useEffect(() => {
    if (!parsedProfileData?.success) {
      return; // Don't process anything until we have profile data
    }

    const poolParam = params.get("pool");
    if (poolParam && parsedProfileData.data.pools.includes(poolParam)) {
      setSelectedPool(poolParam);
    } else if (parsedProfileData.data.profile.pool) {
      setSelectedPool(parsedProfileData.data.profile.pool);
    } else {
      const firstPool = parsedProfileData.data.pools[0];

      if (firstPool) {
        setSelectedPool(firstPool);
      }
    }

    setSelectedPriority((params.get("priority") as PriorityType) ?? "NORMAL");
  }, [params, parsedProfileData]);

  useEffect(() => {
    if (containerRef.current) {
      setEditorHeight(
        windowHeight -
          containerRef.current.getBoundingClientRect().top -
          3 -
          (footerRef.current?.getBoundingClientRect().height ?? 0),
      );
    }
  }, [windowHeight, isLoading, parsedProfileData?.success, selectedPool, error, selectedPriority]);

  const handleSubmit = async () => {
    if (!selectedPool) {
      return;
    }

    const isTemplated =
      file.includes("{%%") || file.includes("{{") || file.includes("{#") || file.includes("default-values");

    setError(undefined);

    await mutation.mutateAsync(
      {
        file: file ?? "",
        renderedSpec: renderedSpec ?? "",
        set_variables: [],
        dry_run: isTemplated,
        pool_name: selectedPool,
        priority: selectedPriority,
      },
      {
        onSuccess: (response) => {
          const parsedResponse = CreateWorkflowResponseSchema.safeParse(response);
          if (parsedResponse.success) {
            router.push(`/workflows/${parsedResponse.data.name}`);
          } else {
            const errorResponse = OSMOErrorResponseSchema.safeParse(response);
            if (errorResponse.success) {
              setError(errorResponse.data.message ?? "Unknown error");
            } else {
              setError("Unknown error");
            }
          }
        },
        onError: (error) => {
          setError(error.message ?? "Unknown error");
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen translate-y-[-10%]">
        <Spinner
          size="large"
          description="Loading..."
        />
      </div>
    );
  }

  if (!parsedProfileData?.success || !selectedPool) {
    return (
      <PageError
        className="h-screen"
        title="Failed to Fetch Available Pools"
        errorMessage="Please contact support or restart your session and try again."
        icon="error_outline"
      />
    );
  }

  return (
    <div className="body-component flex flex-col w-full h-full">
      <div className="flex flex-row gap-3 p-3">
        <Select
          id="pool-select"
          className="w-[25vw]"
          slotLeft={<OutlinedIcon name="cloud" />}
          label="Select a pool to run your workflow in"
          value={selectedPool ?? ""}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setSelectedPool(e.target.value);
            setError(undefined);
          }}
        >
          {parsedProfileData?.data?.pools?.map((pool) => (
            <option
              key={pool}
              value={pool}
            >
              {pool}
            </option>
          )) ?? []}
        </Select>
        <Select
          id="priority-select"
          label="Priority"
          value={selectedPriority}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setSelectedPriority(e.target.value as PriorityType);
            setError(undefined);
          }}
        >
          <option value="LOW">LOW</option>
          <option value="NORMAL">NORMAL</option>
          <option value="HIGH">HIGH</option>
        </Select>
      </div>
      <div
        className="border-1 border-border"
        ref={containerRef}
      >
        <div
          style={{
            height: `${editorHeight}px`,
            overflowY: "auto",
          }}
        >
          <label
            htmlFor="workflow-editor"
            className="sr-only display-none"
          >
            Workflow Submit
          </label>
          <Editor
            autoFocus
            value={file ?? ""}
            onValueChange={(code) => {
              setFile(code);
              setError(undefined);
            }}
            highlight={(code) => (languages.yaml ? highlight(code, languages.yaml, "yaml") : code)}
            padding={15}
            textareaClassName="editor"
            textareaId="workflow-editor"
          />
        </div>
      </div>
      <div
        className="modal-footer p-0 gap-0"
        ref={footerRef}
      >
        <InlineBanner
          status={error ? "error" : selectedPriority === "LOW" ? "warning" : "none"}
          className="w-full"
        >
          <div className="flex flex-row gap-3 justify-between w-full items-center">
            {error ? (
              <div className="whitespace-pre-wrap">{error}</div>
            ) : selectedPriority === "LOW" ? (
              "LOW priority workflows can be preempted during the run"
            ) : (
              <div />
            )}
            <button
              className="btn btn-primary h-8"
              disabled={!selectedPool}
              onClick={() => {
                void handleSubmit();
              }}
            >
              {mutation.isLoading ? (
                <Spinner
                  className="border-black"
                  size="button"
                />
              ) : (
                <OutlinedIcon name="send" />
              )}
              Submit
            </button>
          </div>
        </InlineBanner>
      </div>
    </div>
  );
};
