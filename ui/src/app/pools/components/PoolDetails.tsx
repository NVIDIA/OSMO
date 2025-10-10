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
import React from "react";

import { usePathname, useRouter } from "next/navigation";

import { Spinner } from "~/components/Spinner";
import { Colors, Tag } from "~/components/Tag";

import { AggregatePanels } from "./AggregatePanels";
import { PoolStatus } from "./PoolStatus";
import { type PoolListItem } from "../models/PoolListitem";

const PlatformTag = ({
  platform,
  selectedPlatform,
  platformsAsLinks,
}: {
  platform: string;
  selectedPlatform?: string;
  platformsAsLinks: boolean;
}) => {
  const router = useRouter();
  const pathname = usePathname();

  return platformsAsLinks ? (
    <button
      onClick={() => {
        const newParams = new URLSearchParams(window.location.search);

        newParams.set("platform", platform);
        router.replace(`${pathname}?${newParams.toString()}`);
      }}
      className="tag-container"
    >
      <Tag
        color={Colors.platform}
        className={`${selectedPlatform === platform ? "outline-2 outline-brand border-brand" : ""}`}
      >
        {platform}
      </Tag>
    </button>
  ) : (
    <Tag
      color={Colors.platform}
      className={`inline-block ${selectedPlatform === platform ? "outline-2 outline-brand border-brand" : ""}`}
    >
      {platform}
    </Tag>
  );
};

export const PoolDetails = ({
  name,
  pool,
  selectedPlatform,
  platformsAsLinks = false,
  isShowingUsed,
}: {
  name?: string;
  pool?: PoolListItem;
  selectedPlatform?: string;
  platformsAsLinks?: boolean;
  isShowingUsed?: boolean;
}) => {
  if (!name) {
    return null;
  }

  return (
    <div className="card w-full h-full body-component">
      <div className="brand-header px-3 flex flex-row justify-between items-center gap-3">
        <h3>{name}</h3>
        <Tag
          className="inline-block"
          color={Colors.pool}
        >
          Pool
        </Tag>
      </div>
      {pool ? (
        <>
          {pool.resource_usage && (
            <div
              className="body-header p-3 flex flex-row gap-3 min-h-40"
              role="list"
            >
              <AggregatePanels
                totals={pool.resource_usage}
                isLoading={false}
                isShowingUsed={isShowingUsed ?? true}
              />
            </div>
          )}
          <div className="flex flex-col gap-3 p-3">
            <div className="card p-0">
              <h3
                className="body-header text-base p-3"
                id="platforms"
              >
                Configurations
              </h3>
              <dl className="p-3">
                <dt>Description</dt>
                <dd>{pool.description}</dd>
                <dt>Status</dt>
                <dd>
                  <PoolStatus status={pool.status} />
                </dd>
                <dt>Backend</dt>
                <dd>{pool.backend}</dd>
                <dt>Default Platform</dt>
                <dd>
                  {pool.default_platform ? (
                    <PlatformTag
                      platform={pool.default_platform}
                      selectedPlatform={selectedPlatform}
                      platformsAsLinks={platformsAsLinks}
                    />
                  ) : (
                    "None"
                  )}
                </dd>
                <dt>Default Execute Timeout</dt>
                <dd>{pool.default_exec_timeout}</dd>
                <dt>Default Queue Timeout</dt>
                <dd>{pool.default_queue_timeout}</dd>
                <dt>Max Execute Timeout</dt>
                <dd>{pool.max_exec_timeout}</dd>
                <dt>Max Queue Timeout</dt>
                <dd>{pool.max_queue_timeout}</dd>
              </dl>
            </div>
            {Object.entries(pool.platforms).length > 1 && (
              <div className="card p-0">
                <h3
                  className="body-header text-base p-3"
                  id="platforms"
                >
                  Platforms
                </h3>
                <div className="flex flex-wrap gap-1 m-3">
                  {Object.entries(pool.platforms).map(([platform]) => (
                    <PlatformTag
                      key={platform}
                      platform={platform}
                      selectedPlatform={selectedPlatform}
                      platformsAsLinks={platformsAsLinks}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="card p-0">
              <h3
                className="body-header text-base p-3"
                id="action-permissions"
              >
                Action Permissions
              </h3>
              <dl
                aria-labelledby="action-permissions"
                className="p-3"
              >
                {Object.entries(pool.action_permissions).map(([action, description]) => (
                  <React.Fragment key={action}>
                    <dt className="capitalize">{action}</dt>
                    <dd>{description}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </div>
            {Object.entries(pool.default_exit_actions).length > 0 && (
              <div className="card p-0">
                <h3
                  className="body-header text-base p-3"
                  id="default-exit-actions"
                >
                  Default Exit Actions
                </h3>
                <dl
                  aria-labelledby="default-exit-actions"
                  className="p-3"
                >
                  {Object.entries(pool.default_exit_actions).map(([action, description]) => (
                    <React.Fragment key={action}>
                      <dt className="capitalize">{action}</dt>
                      <dd>{description}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="h-full w-full flex justify-center items-center">
          <Spinner />
        </div>
      )}
    </div>
  );
};
