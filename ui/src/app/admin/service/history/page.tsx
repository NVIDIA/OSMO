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
"use client";

import { useMemo, useState } from "react";

import Link from "next/link";

import { OutlinedIcon } from "~/components/Icon";
import { IconButton } from "~/components/IconButton";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { Spinner } from "~/components/Spinner";
import { api } from "~/trpc/react";

import { HistoryDetailsModal } from "../components/HistoryDetailsModal";
import { HistoryTable } from "../components/HistoryTable";

export default function AdminPage() {
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isShowingDetails, setIsShowingDetails] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [selectedRevisions, setSelectedRevisions] = useState<number[]>([]);

  const configHistory = api.configs.getConfigHistory.useQuery({
    offset: 0,
    limit: 1000,
    order: "DESC",
    config_types: "SERVICE",
    omit_data: false,
  });

  const compareRevisions = useMemo(() => {
    if (isComparing) {
      return configHistory.data?.configs
        .filter((config) => selectedRevisions.includes(config.revision))
        .sort((a, b) => b.revision - a.revision);
    }

    return configHistory.data?.configs;
  }, [selectedRevisions, configHistory.data, isComparing]);

  if (configHistory.error) {
    return (
      <PageError
        title="Error loading service config"
        errorMessage={configHistory.error.message}
      />
    );
  }

  if (configHistory.isLoading || !configHistory.data) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Service Config History">
        {selectedRevisions.length > 0 && (
          <IconButton
            className="btn btn-primary"
            icon="compare"
            text="Compare"
            aria-label="Compare"
            onClick={() => {
              setIsShowingDetails(true);
              setIsComparing(true);
              setHistoryIndex(selectedRevisions.length - 1);
            }}
          />
        )}
        <Link
          href="/admin/service"
          className="btn btn-secondary"
          aria-label="Edit"
        >
          <OutlinedIcon name="edit" />
          <span
            className="hidden lg:block"
            aria-label="Edit"
          >
            Edit
          </span>
        </Link>
      </PageHeader>
      <HistoryTable
        configs={configHistory.data?.configs}
        isLoading={configHistory.isLoading}
        onSelectRevision={(index) => {
          setHistoryIndex(index);
          setIsShowingDetails(true);
          setIsComparing(false);
        }}
        onRowSelectionChange={setSelectedRevisions}
      />
      <HistoryDetailsModal
        open={isShowingDetails}
        onClose={() => setIsShowingDetails(false)}
        configs={compareRevisions ?? []}
        historyIndex={historyIndex}
        setHistoryIndex={setHistoryIndex}
      />
    </>
  );
}
