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
import { useEffect, useState } from "react";

import { useSearchParams } from "next/navigation";

import { env } from "~/env.mjs";

import PoolPlatform from "../components/PoolPlatform";

export default function PoolPlatformPage({ params }: { params: { pool: string } }) {
  const [platform, setPlatform] = useState<string | undefined>(undefined);
  const urlParams = useSearchParams();

  useEffect(() => {
    document.title = `${env.NEXT_PUBLIC_APP_NAME} Pool: ${params.pool}`;
  }, [params.pool]);

  useEffect(() => {
    setPlatform(urlParams.get("platform") ?? undefined);
  }, [urlParams]);

  return (
    <PoolPlatform
      pool={params.pool}
      platform={platform}
    />
  );
}
