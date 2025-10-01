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
import React, { useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { PlatformDetails } from "~/app/resources/components/PlatformDetails";
import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { Colors, Tag } from "~/components/Tag";
import { PoolsListResponseSchema } from "~/models";
import { api } from "~/trpc/react";

import { PoolStatus } from "./PoolStatus";
import { type PoolListItem } from "../models/PoolListitem";
import { poolToPoolListItem } from "../models/PoolListitem";

export const PoolDetails = ({
  pools,
  selectedPool,
  selectedPlatform,
  isShowingUsed,
  onShowPlatformDetails,
  showActions = true,
}: {
  pools?: PoolListItem[];
  selectedPool?: string;
  selectedPlatform?: string;
  isShowingUsed: boolean;
  onShowPlatformDetails?: (platform?: string | null) => void;
  showActions?: boolean;
}) => {
  const [localPools, setLocalPools] = useState(pools);

  const { data: availablePools } = api.resources.getPools.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    enabled: !pools,
  });

  useEffect(() => {
    setLocalPools(pools);
  }, [pools]);

  useEffect(() => {
    // The type of parsedAvailablePools is not an array, but a record (object) mapping pool names to pool objects.
    // So, to get an array, use Object.values.
    const parsedData = PoolsListResponseSchema.safeParse(availablePools);
    const parsedAvailablePools = parsedData.success ? Object.values(parsedData.data.pools) : [];
    const pools = parsedAvailablePools.map((p) => poolToPoolListItem(p));

    setLocalPools(pools);
  }, [availablePools]);

  const pool = useMemo(() => {
    if (selectedPool && localPools) {
      return localPools.find((pool) => pool.name === selectedPool);
    } else {
      return undefined;
    }
  }, [selectedPool, localPools]);

  const platform = useMemo(() => {
    if (selectedPlatform && pool) {
      return pool.platforms[selectedPlatform];
    } else {
      return undefined;
    }
  }, [selectedPlatform, pool]);

  if (!pool) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col">
        <div className="body-header text-center p-3">{pool.description}</div>
        <div className="flex flex-col gap-3 pb-3">
          <dl className="p-3">
            <dt>Status</dt>
            <dd>
              <PoolStatus status={pool.status} />
            </dd>
            <dt>Backend</dt>
            <dd>{pool.backend}</dd>
            <dt>Default Platform</dt>
            <dd>
              {onShowPlatformDetails ? (
                <button
                  className="tag-container"
                  onClick={() => onShowPlatformDetails(pool.default_platform ?? undefined)}
                >
                  <Tag color={Colors.platform}>{pool.default_platform}</Tag>
                </button>
              ) : (
                <Tag
                  className="inline-block"
                  color={Colors.platform}
                >
                  {pool.default_platform}
                </Tag>
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
          {pool.resource_usage && (
            <>
              <h3 className="body-header text-base px-3">Resource Usage</h3>
              <dl className="px-3">
                {isShowingUsed ? (
                  <>
                    <dt>Quota Used</dt>
                    <dd>{pool.resource_usage.quota_used}</dd>
                    <dt>Quota Limit</dt>
                    <dd>{pool.resource_usage.quota_limit}</dd>
                    <dt>Total Usage</dt>
                    <dd>{pool.resource_usage.total_usage}</dd>
                    <dt>Total Capacity</dt>
                    <dd>{pool.resource_usage.total_capacity}</dd>
                  </>
                ) : (
                  <>
                    <dt>Quota Free</dt>
                    <dd>{pool.resource_usage.quota_free}</dd>
                    <dt>Total Free</dt>
                    <dd>{pool.resource_usage.total_free}</dd>
                  </>
                )}
              </dl>
            </>
          )}
          {onShowPlatformDetails && Object.entries(pool.platforms).length > 1 && (
            <>
              <h3
                className="body-header text-base px-3"
                id="platforms"
              >
                Platforms
              </h3>
              <div className="flex flex-wrap gap-1 mx-3">
                {Object.entries(pool.platforms).map(([platform]) => (
                  <button
                    key={platform}
                    className="tag-container"
                    onClick={() => onShowPlatformDetails(platform)}
                  >
                    <Tag color={Colors.platform}>{platform}</Tag>
                  </button>
                ))}
              </div>
            </>
          )}
          <h3
            className="body-header text-base px-3"
            id="action-permissions"
          >
            Action Permissions
          </h3>
          <dl
            aria-labelledby="action-permissions"
            className="px-3"
          >
            {Object.entries(pool.action_permissions).map(([action, description]) => (
              <React.Fragment key={action}>
                <dt className="capitalize">{action}</dt>
                <dd>{description}</dd>
              </React.Fragment>
            ))}
          </dl>
          {Object.entries(pool.default_exit_actions).length > 0 && (
            <>
              <h3
                className="body-header text-base px-3"
                id="default-exit-actions"
              >
                Default Exit Actions
              </h3>
              <dl
                aria-labelledby="default-exit-actions"
                className="px-3"
              >
                {Object.entries(pool.default_exit_actions).map(([action, description]) => (
                  <React.Fragment key={action}>
                    <dt className="capitalize">{action}</dt>
                    <dd>{description}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </>
          )}
        </div>
      </div>
      {showActions && (
        <div
          className={`dag-actions body-footer lg:sticky lg:bottom-0`}
          role="list"
          aria-label="Workflow Actions"
        >
          <Link
            href={`/workflows?allPools=false&pools=${pool.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-action"
            role="listitem"
          >
            <OutlinedIcon name="work_outline" />
            My Workflows
          </Link>
          <Link
            href={`/tasks?allPools=false&pools=${pool.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-action"
            role="listitem"
          >
            <OutlinedIcon name="task" />
            My Tasks
          </Link>
          <Link
            href={`/workflows?allPools=false&pools=${pool.name}&allUsers=true`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-action"
            role="listitem"
          >
            <OutlinedIcon name="work_outline" />
            All Workflows
          </Link>
          <Link
            href={`/tasks?allPools=false&pools=${pool.name}&allUsers=true`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-action"
            role="listitem"
          >
            <OutlinedIcon name="task" />
            All Tasks
          </Link>
          <Link
            href={`/resources?allPools=false&pools=${pool.name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-action"
            role="listitem"
          >
            <OutlinedIcon name="cloud" />
            View Resources
          </Link>
        </div>
      )}
      {onShowPlatformDetails && (
        <FullPageModal
          open={!!platform}
          onClose={() => {
            onShowPlatformDetails(null);
          }}
          headerChildren={<h2>{selectedPlatform}</h2>}
          size="none"
        >
          <PlatformDetails
            hostNetwork={platform?.host_network_allowed}
            privileged={platform?.privileged_allowed}
            defaultMounts={platform?.default_mounts}
            allowedMounts={platform?.allowed_mounts}
            className="overflow-y-auto max-h-[85vh] sm:grid sm:grid-cols-3 p-3"
          />
        </FullPageModal>
      )}
    </>
  );
};
