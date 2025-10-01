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
import { useEffect, useState } from "react";

import { env } from "~/env.mjs";
import { type WorkflowResponse } from "~/models";
import { api } from "~/trpc/react";

export const useWorkflow = (
  name = "",
  verbose = true,
  retry: boolean | number | ((failureCount: number, error: unknown) => boolean),
) => {
  const [refetchInterval, setRefetchInterval] = useState(0);
  const query = api.workflows.getWorkflow.useQuery<WorkflowResponse>(
    { name, verbose },
    {
      enabled: !!name,
      refetchInterval: refetchInterval,
      retry: retry,
      refetchOnWindowFocus: false,
      onError: (error) => {
        console.error(error);
        setRefetchInterval(0);
      },
    },
  );

  useEffect(() => {
    setRefetchInterval(
      query.data?.status === "RUNNING" || query.data?.status === "WAITING" || query.data?.status === "PENDING"
        ? (env.NEXT_PUBLIC_WORKFLOW_REFETCH_INTERVAL / 4) * 1000
        : 0,
    );
  }, [query.data]);

  return query;
};
