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
import { useMemo } from "react";

import FullPageModal from "~/components/FullPageModal";
import { PageError } from "~/components/PageError";
import { type DatasetTypesSchema, type DataInfoResponse, type DataInfoDatasetEntry } from "~/models";

import { DeleteCollection } from "./DeleteCollection";
import { LabelEditor } from "./LabelEditor";
import { MetadataEditor } from "./MetadataEditor";
import { Rename } from "./Rename";
import TagEditor from "./TagEditor";
import { useToolParamUpdater, ToolType } from "../hooks/useToolParamUpdater";

export interface OnSaveResponse {
  success: boolean;
  message: string;
}

interface ToolsModalProps {
  tool?: ToolType;
  dataset: DataInfoResponse<DatasetTypesSchema.Dataset | DatasetTypesSchema.Collection>;
  selectedVersionData?: DataInfoDatasetEntry;
  refetch: () => void;
}

export const ToolsModal = ({ tool, selectedVersionData, dataset, refetch }: ToolsModalProps) => {
  const toolParamUpdater = useToolParamUpdater();

  const header = useMemo(() => {
    if (tool === ToolType.Delete) {
      return <h2>Delete Collection</h2>;
    }

    return <h2 className="capitalize">{tool}</h2>;
  }, [tool]);

  return (
    <FullPageModal
      open={!!tool}
      onClose={() => {
        toolParamUpdater({ tool: null });
      }}
      headerChildren={header}
      size={
        tool === ToolType.Delete || tool === ToolType.Rename
          ? "none"
          : tool === ToolType.Tags || tool === ToolType.Labels
            ? "sm"
            : "md"
      }
    >
      <div className="flex flex-col gap-3 h-full w-full">
        {tool === ToolType.Metadata ? (
          <MetadataEditor
            dataset={dataset}
            selectedVersionData={selectedVersionData}
            refetch={refetch}
          />
        ) : tool === ToolType.Delete ? (
          <DeleteCollection dataset={dataset} />
        ) : tool === ToolType.Tags ? (
          <TagEditor
            dataset={dataset}
            selectedVersionData={selectedVersionData}
            refetch={refetch}
          />
        ) : tool === ToolType.Labels ? (
          <LabelEditor
            dataset={dataset}
            refetch={refetch}
          />
        ) : tool === ToolType.Rename ? (
          <Rename dataset={dataset} />
        ) : (
          <PageError
            title="Coming Soon..."
            errorMessage=""
          />
        )}
      </div>
    </FullPageModal>
  );
};
