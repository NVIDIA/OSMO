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
import { type InputHTMLAttributes } from "react";

import { Accordion } from "./Accordion";
import { Multiselect } from "./Multiselect";
import { Switch } from "./Switch";

interface MultiselectProps {
  id: string;
  label: string;
  filter: Map<string, boolean>;
  setFilter: (filter: Map<string, boolean>) => void;
  onSelectAll: (checked: boolean) => void;
  isSelectAllChecked?: boolean;
  showAll?: boolean;
}

export const MultiselectWithAll: React.FC<MultiselectProps & Omit<InputHTMLAttributes<HTMLInputElement>, "value">> = ({
  id,
  label,
  filter,
  setFilter,
  onSelectAll,
  isSelectAllChecked,
  showAll = false,
  className = "",
  ...props
}) => {
  const [openIndex, setOpenIndex] = useState<number>(-1);

  useEffect(() => {
    setOpenIndex(isSelectAllChecked ? -1 : 0);
  }, [isSelectAllChecked]);

  return (
    <Accordion
      openIndex={openIndex}
      setOpenIndex={setOpenIndex}
      items={[
        {
          slotLeft: (
            <Switch
              className={"whitespace-nowrap"}
              labelPosition="right"
              size="small"
              id={`${id}-select-all`}
              label={label}
              checked={isSelectAllChecked ?? false}
              onChange={(checked) => {
                onSelectAll(checked);
              }}
            />
          ),
          disabled: isSelectAllChecked,
          content: (
            <Multiselect
              id={id}
              filter={filter}
              setFilter={setFilter}
              showAll={showAll}
              className={className}
              {...props}
            />
          ),
        },
      ]}
    />
  );
};
