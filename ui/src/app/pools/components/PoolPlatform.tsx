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

import { useEffect, useMemo, useRef, useState } from "react";

import { PoolDetails } from "~/app/pools/components/PoolDetails";
import useToolParamUpdater from "~/app/pools/hooks/useToolParamUpdater";
import { PlatformDetails } from "~/app/resources/components/PlatformDetails";
import { OutlinedIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import { UrlTypes } from "~/components/StoreProvider";
import { api } from "~/trpc/react";

import { PoolActions } from "./PoolActions";
import { UsedFreeToggle } from "./UsedFreeToggle";
import { processPoolsQuotaResponse } from "../models/PoolListitem";

export default function PoolPlatform({ pool, platform }: { pool: string; platform?: string }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const { updateUrl, isShowingUsed } = useToolParamUpdater(UrlTypes.Pools);
  const [poolPlatform, setPoolPlatform] = useState<string | undefined>(platform);
  const [showActions, setShowActions] = useState(false);

  const {
    data: nodeSets,
    isSuccess,
    isLoading,
  } = api.resources.getPoolsQuota.useQuery(
    {
      all_pools: false,
      pools: [pool],
    },
    {
      refetchOnWindowFocus: false,
    },
  );

  const { pools } = useMemo(() => {
    return processPoolsQuotaResponse(isSuccess, nodeSets);
  }, [nodeSets, isSuccess]);

  useEffect(() => {
    if (platform) {
      setPoolPlatform(platform);
    } else if (pools[0]?.default_platform) {
      setPoolPlatform(pools[0]?.default_platform);
    }
  }, [platform, pools]);

  const platformDetails = useMemo(() => {
    return poolPlatform ? pools[0]?.platforms[poolPlatform] : undefined;
  }, [pools, poolPlatform]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Spinner
          size="large"
          description="Loading..."
        />
      </div>
    );
  }

  if (!pools[0]) {
    return (
      <PageError
        title={`Failed to Fetch Pool`}
        errorMessage={`Pool ${pool} not found`}
      />
    );
  }

  return (
    <>
      <div
        className="page-header"
        ref={headerRef}
      >
        <h1>{pool}</h1>
        <div className="flex items-center gap-3">
          <UsedFreeToggle
            isShowingUsed={isShowingUsed}
            updateUrl={updateUrl}
          />
          <button
            className="btn"
            onClick={() => setShowActions(true)}
          >
            <OutlinedIcon name="more_vert" />
            Actions
          </button>
        </div>
        <SlideOut
          id="workflows-filters"
          open={showActions}
          onClose={() => setShowActions(false)}
          containerRef={headerRef}
          top={headerRef.current?.offsetHeight ?? 0}
          dimBackground={false}
          className="border-t-0"
          bodyClassName="p-3"
        >
          <PoolActions name={pool} />
        </SlideOut>
      </div>
      <div className="flex flex-col xs:grid xs:grid-cols-[1fr_2fr] gap-3 p-3 w-full grow">
        <PoolDetails
          name={pool}
          pool={pools[0]}
          selectedPlatform={poolPlatform}
          platformsAsLinks={true}
          isShowingUsed={isShowingUsed}
        />
        {poolPlatform && (
          <PlatformDetails
            name={poolPlatform}
            showLoadError={!platformDetails}
            hostNetwork={platformDetails?.host_network_allowed}
            privileged={platformDetails?.privileged_allowed}
            defaultMounts={platformDetails?.default_mounts}
            allowedMounts={platformDetails?.allowed_mounts}
          />
        )}
      </div>
    </>
  );
}
