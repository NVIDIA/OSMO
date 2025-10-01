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
import { useEffect, useState } from "react";

export interface SmartLabel {
  task?: string;
  isError?: boolean;
  suffix?: string;
}

export const makeSmartLabel = (label: SmartLabel): string => {
  return JSON.stringify(label);
};

export const LogOption = ({ label }: { label?: string }) => {
  const [meta, setMeta] = useState<SmartLabel | undefined>(undefined);

  useEffect(() => {
    if (label) {
      setMeta(JSON.parse(label) as SmartLabel);
    }
  }, [label]);

  return (
    <div className="flex flex-row gap-1 items-center">
      {<strong>{meta?.task ?? "Workflow"}</strong>}
      {meta?.isError ? "Error" : meta?.task ? "Task" : ""} {meta?.suffix ?? "Logs"}
    </div>
  );
};
