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

import { useState } from "react";

import Link from "next/link";

import { OutlinedIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { Spinner } from "~/components/Spinner";
import { api } from "~/trpc/react";

import { ServiceConfigEditor } from "./components/ServiceConfigEditor";

export default function AdminPage() {
  const serviceConfig = api.configs.getServiceConfig.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const patchServiceConfig = api.configs.patchServiceConfig.useMutation();
  const [error, setError] = useState<string | undefined>(undefined);

  if (serviceConfig.error) {
    return (
      <PageError
        title="Error loading service config"
        errorMessage={serviceConfig.error.message}
      />
    );
  }

  if (serviceConfig.isLoading || !serviceConfig.data) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Service Config">
        <Link
          href="/admin/service/history"
          className="btn btn-secondary"
        >
          <OutlinedIcon name="history" />
          History
        </Link>
      </PageHeader>
      <div className="flex flex-col w-full">
        <ServiceConfigEditor
          serviceConfig={serviceConfig.data}
          onSave={async (description, tags, config) => {
            setError(undefined);
            try {
              await patchServiceConfig.mutateAsync({
                description,
                tags,
                configs_dict: config,
              });
              await serviceConfig.refetch();
            } catch (err) {
              const message = err instanceof Error ? err.message : "Failed to update service config";
              setError(message);
            }
          }}
          error={error}
        />
      </div>
    </>
  );
}
