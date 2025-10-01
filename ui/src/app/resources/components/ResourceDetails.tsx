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
import { useEffect, useMemo, useState } from "react";

import { z } from "zod";

import { PoolDetails } from "~/app/pools/components/PoolDetails";
import { Container } from "~/components/Container";
import { PageError } from "~/components/PageError";
import { Spinner } from "~/components/Spinner";
import { Tag, Colors } from "~/components/Tag";
import { convertResourceValueStr, type ResourceAllocation, ResourcesEntrySchema } from "~/models";
import { api } from "~/trpc/react";

import { PlatformDetails } from "./PlatformDetails";

export interface PoolAndPlatform {
  pool: string;
  platform: string;
}

export interface NodePoolAndPlatform extends PoolAndPlatform {
  node: string;
}

export interface ResourceListItem extends NodePoolAndPlatform {
  storage: ResourceAllocation;
  cpu: ResourceAllocation;
  memory: ResourceAllocation;
  gpu: ResourceAllocation;
  resourceType: string;
}

export const checkResourceMatches = (resourceA?: ResourceListItem, resourceB?: NodePoolAndPlatform) => {
  if (!resourceA || !resourceB) {
    return false;
  }

  return (
    resourceA.node === resourceB.node && resourceA.pool === resourceB.pool && resourceA.platform === resourceB.platform
  );
};

const poolAndPlatformToString = (pair?: PoolAndPlatform): string | undefined => {
  if (!pair) {
    return undefined;
  }

  return `${pair.pool}/${pair.platform}`;
};

const getPoolPlatforms = (poolPlatforms?: Record<string, string[]>) => {
  if (!poolPlatforms) {
    return [];
  }

  return Object.entries(poolPlatforms).flatMap(([pool, platforms]) =>
    platforms.map((platform) => ({ pool, platform })),
  );
};

export const ResourceDetails = ({
  node,
  defaultPool,
  defaultPlatform,
  className,
  narrowView = false,
  children,
}: {
  node: string;
  defaultPool?: string;
  defaultPlatform?: string;
  className?: string;
  narrowView?: boolean;
  children?: React.ReactNode;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [selectedPoolAndPlatform, setSelectedPoolAndPlatform] = useState<PoolAndPlatform | undefined>(undefined);

  const { data, isLoading } = api.resources.getResourceInfo.useQuery(
    {
      name: node,
    },
    {
      refetchOnWindowFocus: true,
    },
  );

  // Memoizing parsing the data to ensure it's the right response type
  const resource = useMemo(() => {
    if (!data) {
      return null;
    }

    const parsedData = z.array(ResourcesEntrySchema).safeParse(data);
    if (!parsedData.success) {
      console.error(parsedData.error);
      setError(parsedData.error.message);

      return null;
    }

    if (parsedData.data.length === 0) {
      setError("No data found");
      return null;
    }

    return parsedData.data[0];
  }, [data]);

  useEffect(() => {
    if (defaultPool && defaultPlatform) {
      setSelectedPoolAndPlatform({ pool: defaultPool, platform: defaultPlatform });
    } else {
      setSelectedPoolAndPlatform(getPoolPlatforms(resource?.pool_platform_labels)[0]);
    }
  }, [defaultPool, defaultPlatform, resource]);

  const showPoolPlatformList = useMemo(() => {
    const poolPlatforms = getPoolPlatforms(resource?.pool_platform_labels);

    if (poolPlatforms.length < 2) {
      return null;
    }

    return (
      <table className="border-1 border-border shadow-sm shadow-neutral-400/50">
        <thead className="body-header">
          <tr>
            <th className="text-left">Pool</th>
            <th className="text-left">Platform</th>
            <th className="text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {poolPlatforms.map((pair) => (
            <tr key={poolAndPlatformToString(pair)}>
              <td>
                <Tag
                  className="inline-block"
                  color={Colors.pool}
                >
                  {pair.pool}
                </Tag>
              </td>
              <td>
                <Tag
                  className="inline-block"
                  color={Colors.platform}
                >
                  {pair.platform}
                </Tag>
              </td>
              <td>
                <button
                  className={`btn ${selectedPoolAndPlatform?.pool === pair.pool && selectedPoolAndPlatform?.platform === pair.platform ? "btn-primary" : "btn-tertiary"} text-sm! py-0 min-h-0 text-start border-none`}
                  onClick={() => setSelectedPoolAndPlatform(pair)}
                  aria-label={`View details for ${poolAndPlatformToString(pair)}`}
                  aria-current={
                    selectedPoolAndPlatform?.pool === pair.pool && selectedPoolAndPlatform?.platform === pair.platform
                  }
                >
                  Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }, [resource?.pool_platform_labels, selectedPoolAndPlatform?.platform, selectedPoolAndPlatform?.pool]);

  const showPoolPlatformDetails = useMemo(() => {
    if (!resource || !selectedPoolAndPlatform) {
      return null;
    }

    const platformConfig = resource.config_fields?.[selectedPoolAndPlatform.pool]?.[selectedPoolAndPlatform.platform];
    const fields =
      resource.platform_allocatable_fields?.[selectedPoolAndPlatform.pool]?.[selectedPoolAndPlatform.platform];

    return (
      <>
        {fields && (
          <div className={`grid gap-4 ${narrowView ? "grid-cols-2" : "grid-cols-4 min-h-40"}`}>
            <div className="card text-center items-center justify-center">
              <h2>{Math.floor(convertResourceValueStr(fields.storage?.toString() ?? "0"))}</h2>
              <p>Storage [Gi]</p>
            </div>
            <div className="card text-center items-center justify-center">
              <h2>{Math.floor(convertResourceValueStr(fields.memory?.toString() ?? "0"))}</h2>
              <p>Memory [Gi]</p>
            </div>
            <div className="card text-center items-center justify-center">
              <h2>{parseFloat(fields.cpu?.toString() ?? "0")}</h2>
              <p>CPU [#]</p>
            </div>
            <div className="card text-center items-center justify-center">
              <h2>{parseFloat(fields.gpu?.toString() ?? "0")}</h2>
              <p>GPU [#]</p>
            </div>
          </div>
        )}
        {platformConfig && (
          <PlatformDetails
            hostNetwork={platformConfig.host_network}
            privileged={platformConfig.privileged}
            defaultMounts={platformConfig.default_mounts}
            allowedMounts={platformConfig.allowed_mounts}
            className={narrowView ? "flex flex-col" : "grid grid-cols-3 h-full"}
          />
        )}
      </>
    );
  }, [narrowView, resource, selectedPoolAndPlatform]);

  return (
    <Container className={`${className} h-full p-0! gap-0!`}>
      {isLoading ? (
        <div className="h-full flex justify-center items-center">
          <Spinner
            description="Loading Resource..."
            size="large"
          />
        </div>
      ) : (error ?? !resource) ? (
        <PageError
          title="Failed to Fetch Resource"
          errorMessage="This may be related to an access issue. Contact #osmo-support on further assistance."
          subText="Double-check your URL path to make sure the resource exists."
          subTextTitle="Resource Not Found"
        />
      ) : (
        <>
          {children}
          <div className="flex flex-col gap-3 p-3">
            {showPoolPlatformList}
            <div className="card">
              <h3 className="brand-header text-base px-3 text-center">{selectedPoolAndPlatform?.pool}</h3>
              <PoolDetails
                selectedPool={selectedPoolAndPlatform?.pool}
                selectedPlatform={selectedPoolAndPlatform?.platform}
                isShowingUsed={false}
                showActions={false}
              />
            </div>
            {showPoolPlatformDetails}
          </div>
        </>
      )}
    </Container>
  );
};
