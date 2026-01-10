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

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { Spinner } from "~/components/Spinner";
import { ViewToggleButton } from "~/components/ViewToggleButton";
import { api } from "~/trpc/react";

import { ServiceConfigCard } from "./components/ServiceConfig";

export default function AdminPage() {
  const [isShowingJSON, setIsShowingJSON] = useState(false);
  const [isShowingHistory, setIsShowingHistory] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(0);
  const serviceConfig = api.configs.getServiceConfig.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const configHistory = api.configs.getConfigHistory.useQuery({
    offset: 0,
    limit: 20,
    order: "DESC",
    config_types: "SERVICE",
    omit_data: false,
  });

  const previousVersion = useMemo(() => {
    return configHistory.data?.configs[historyIndex + 1];
  }, [historyIndex, configHistory.data]);

  const nextVersion = useMemo(() => {
    return configHistory.data?.configs[historyIndex - 1];
  }, [historyIndex, configHistory.data]);

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
      <PageHeader title="Service Configuration">
        {isShowingHistory && configHistory.data?.configs[historyIndex] && (
          <div className="flex flex-row gap-1 items-center justify-center grow">
            {previousVersion ? (
              <button
                onClick={() => {
                  setHistoryIndex(historyIndex + 1);
                }}
                title="Previous Version"
              >
                <OutlinedIcon
                  name="keyboard_double_arrow_left"
                  className="text-lg!"
                />
              </button>
            ) : (
              <OutlinedIcon
                name="keyboard_double_arrow_left"
                className="text-lg! mx-1 opacity-50"
              />
            )}
            <h2 className="whitespace-nowrap overflow-hidden text-ellipsis">
              Revision {configHistory.data.configs[historyIndex]?.revision}
            </h2>
            {nextVersion ? (
              <button
                onClick={() => {
                  setHistoryIndex(historyIndex - 1);
                }}
                title="Next Version"
              >
                <OutlinedIcon
                  name="keyboard_double_arrow_right"
                  className="text-lg!"
                />
              </button>
            ) : (
              <OutlinedIcon
                name="keyboard_double_arrow_right"
                className="text-lg! mx-1 opacity-50"
              />
            )}
          </div>
        )}
        <fieldset
          className="toggle-group"
          aria-label="View Type"
        >
          <ViewToggleButton
            name="isShowingJSON"
            checked={!isShowingJSON}
            onChange={() => {
              setIsShowingJSON(false);
            }}
          >
            Details
          </ViewToggleButton>
          <ViewToggleButton
            name="isShowingJSON"
            checked={isShowingJSON}
            onChange={() => {
              setIsShowingJSON(true);
            }}
          >
            JSON
          </ViewToggleButton>
        </fieldset>
        <button
          className={`btn ${isShowingHistory ? "btn-primary" : "btn-secondary"}`}
          onClick={() => {
            setIsShowingHistory(!isShowingHistory);
          }}
        >
          <OutlinedIcon name="history" />
          History
        </button>
      </PageHeader>
      <div className="flex flex-col w-full">
        {isShowingHistory && configHistory.data?.configs[historyIndex] && (
          <InlineBanner status="info">
            <p>
              Created by <strong>{configHistory.data.configs[historyIndex]?.username}</strong> on{" "}
              <strong>
                {configHistory.data.configs[historyIndex]?.created_at.toLocaleString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </strong>
              . {configHistory.data.configs[historyIndex]?.description}
            </p>
          </InlineBanner>
        )}
        <ServiceConfigCard
          serviceConfig={
            isShowingHistory
              ? (configHistory.data?.configs[historyIndex]?.data ?? serviceConfig.data)
              : serviceConfig.data
          }
          isShowingJSON={isShowingJSON}
          canEdit={!isShowingHistory || !nextVersion}
        />
      </div>
    </>
  );
}
