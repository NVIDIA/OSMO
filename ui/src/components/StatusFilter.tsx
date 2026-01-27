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
import { useState, useEffect } from "react";

import { setEachValueInMap } from "~/utils/state";

import { Accordion } from "./Accordion";
import { CheckboxWithLabel } from "./Checkbox";
import { Switch } from "./Switch";

export const StatusFilter = ({
  statusMap,
  setStatusMap,
  className,
  allStatuses,
  setAllStatuses,
}: {
  statusMap: Map<any, boolean>;
  setStatusMap: (map: Map<any, boolean>) => void;
  className?: string;
  allStatuses: boolean;
  setAllStatuses: (allStatuses: boolean) => void;
}) => {
  const [openIndex, setOpenIndex] = useState<number>(-1);

  useEffect(() => {
    const count = Array.from(statusMap.values()).filter(Boolean).length;
    if (count === 0) {
      setAllStatuses(false);
    } else if (count === statusMap.size) {
      setAllStatuses(true);
    } else {
      setAllStatuses(false);
    }
  }, [statusMap, setAllStatuses]);

  useEffect(() => {
    setOpenIndex(allStatuses ? -1 : 0);
  }, [allStatuses]);

  return (
    <div className={className}>
      <Accordion
        items={[
          {
            slotLeft: (
              <Switch
                id="select-all"
                label="All Statuses"
                labelPosition="right"
                size="small"
                className="whitespace-nowrap"
                checked={allStatuses ?? false}
                onChange={(checked) => {
                  setAllStatuses(checked);
                  setStatusMap(setEachValueInMap<any, boolean>(statusMap, checked));
                }}
              />
            ),
            content: (
              <>
                {Array.from(statusMap.entries()).map(([name, checked]) => (
                  <CheckboxWithLabel
                    key={name}
                    label={name}
                    checked={checked}
                    containerClassName="p-1"
                    onChange={(event) => {
                      const newMap = new Map(statusMap);
                      newMap.set(name, Boolean(event.target.checked));
                      setStatusMap(newMap);
                    }}
                  />
                ))}
              </>
            ),
          },
        ]}
        openIndex={openIndex}
        setOpenIndex={setOpenIndex}
      />
    </div>
  );
};
