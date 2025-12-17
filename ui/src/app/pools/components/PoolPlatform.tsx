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

import { PoolDetails } from "~/app/pools/components/PoolDetails";
import useToolParamUpdater from "~/app/pools/hooks/useToolParamUpdater";
import { PlatformDetails } from "~/app/resources/components/PlatformDetails";
import { IconButton } from "~/components/IconButton";
import { PageError } from "~/components/PageError";
import PageHeader from "~/components/PageHeader";
import { SlideOut } from "~/components/SlideOut";
import { Spinner } from "~/components/Spinner";
import { UrlTypes } from "~/components/StoreProvider";
import { api } from "~/trpc/react";

import { PoolActions } from "./PoolActions";
import { UsedFreeToggle } from "./UsedFreeToggle";
import { processPoolsQuotaResponse } from "../models/PoolListitem";

export default function PoolPlatform({ pool, platform }: { pool: string; platform?: string }) {
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
      <div className="flex justify-center items-center h-full w-full">
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
      <PageHeader>
        <UsedFreeToggle
          isShowingUsed={isShowingUsed}
          updateUrl={updateUrl}
        />
        <IconButton
          icon="more_vert"
          text="Actions"
          className="btn"
          onClick={() => setShowActions(true)}
          aria-controls="pool-actions"
          aria-expanded={showActions}
          aria-haspopup="menu"
        />
      </PageHeader>
      <div className="flex flex-col gap-global xs:gap-0 xs:grid xs:grid-cols-[1fr_2fr] xs:h-full w-full relative xs:overflow-x-auto">
        <SlideOut
          id="pool-actions"
          open={showActions}
          onClose={() => setShowActions(false)}
          className="border-t-0 shadow-lg"
          bodyClassName="p-global"
          dimBackground={false}
        >
          <PoolActions name={pool} />
        </SlideOut>
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
