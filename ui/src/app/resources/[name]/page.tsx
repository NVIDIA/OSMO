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
import { useEffect } from "react";

import Link from "next/link";

import { GenericHeader } from "~/components/Header";
import { getTaskHistoryUrl } from "~/components/TaskHistoryBanner";
import { env } from "~/env.mjs";

import { ResourceDetails } from "../components/ResourceDetails";

interface ResourcesSlugParams {
  params: {
    name: string;
  };
}

export default function ResourceOverviewPage({ params }: ResourcesSlugParams) {
  useEffect(() => {
    document.title = `${env.NEXT_PUBLIC_APP_NAME} Resource: ${params.name}`;
  }, [params.name]);

  return (
    <>
      <GenericHeader
        rootSegment="resources"
        tailSegment={[params.name]}
      >
        <Link
          href={getTaskHistoryUrl(params.name)}
          className="btn btn-secondary"
        >
          Task History
        </Link>
      </GenericHeader>
      <div>
        <ResourceDetails node={params.name} />
      </div>
    </>
  );
}
