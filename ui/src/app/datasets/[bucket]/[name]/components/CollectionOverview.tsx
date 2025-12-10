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

import PageHeader from "~/components/PageHeader";
import { Colors, Tag } from "~/components/Tag";
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

  useEffect(() => {
    setTool(searchParams.get(PARAM_KEYS.tool) as ToolType | undefined);
  }, [searchParams, toolParamUpdater]);

  return (
    <>
      <PageHeader>
        <h2 className="grow">
          {dataset.bucket}/{dataset.name}
        </h2>
        <Tag color={Colors.collection}>Collection</Tag>
      </PageHeader>
      <div className="grid h-full w-full grid-cols-[1fr_auto] relative">
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
