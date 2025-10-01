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

import { useEffect, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

import { DatasetTag } from "~/components/Tag";
import { type DataInfoResponse, type DatasetTypesSchema } from "~/models";

import { CollectionDetails } from "./CollectionDetails";
import { CollectionVersionsTable } from "./CollectionVersionsTable";
import { ToolsModal } from "./ToolsModal";
import useToolParamUpdater, { PARAM_KEYS, type ToolType } from "../hooks/useToolParamUpdater";

export default function CollectionOverview({
  dataset,
  refetch,
}: {
  dataset: DataInfoResponse<DatasetTypesSchema.Collection>;
  refetch: () => void;
}) {
  const searchParams = useSearchParams();
  const toolParamUpdater = useToolParamUpdater();
  const [tool, setTool] = useState<ToolType | undefined>(undefined);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTool(searchParams.get(PARAM_KEYS.tool) as ToolType | undefined);
  }, [searchParams, toolParamUpdater]);

  return (
    <>
      <div
        className="page-header mb-3 flex items-center text-center gap-3"
        ref={headerRef}
      >
        <DatasetTag isCollection={dataset.type === "COLLECTION"}>{dataset.type}</DatasetTag>
        <h1>
          {dataset.bucket}/{dataset.name}
        </h1>
        <div className="w-25" />
      </div>
      <div className="grid h-full w-full gap-3 grid-cols-[1fr_auto] relative px-3">
        <CollectionVersionsTable collection={dataset} />
        <CollectionDetails dataset={dataset} />
      </div>
      <ToolsModal
        tool={tool}
        refetch={refetch}
        dataset={dataset}
      />
    </>
  );
}
