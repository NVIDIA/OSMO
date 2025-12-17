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
import { useMemo, useRef, useState } from "react";
import { type InputHTMLAttributes } from "react";

import { OutlinedIcon } from "./Icon";
import { Colors, Tag, TagSizes } from "./Tag";
import { TextInput } from "./TextInput";
import { useSafeTimeout } from "../hooks/useSafeTimeout";

interface MultiselectProps {
  id: string;
  filter: Map<string, boolean>;
  setFilter: (filter: Map<string, boolean>) => void;
  showAll?: boolean;
}

const maxOptions = 10;

export const Multiselect: React.FC<MultiselectProps & Omit<InputHTMLAttributes<HTMLInputElement>, "value">> = ({
  id,
  filter,
  setFilter,
  showAll = false,
  ...props
}) => {
  const [searchValue, setSearchValue] = useState<string>("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [lastActionText, setLastActionText] = useState<string>("");
  const { setSafeTimeout } = useSafeTimeout();

  const selectedOptions = useMemo(() => {
    return Array.from(filter.entries())
      .filter(([_, checked]) => checked)
      .map(([name]) => ({ label: name, value: name, isChecked: false }));
  }, [filter]);

  const availableOptions = useMemo(() => {
    return Array.from(filter.entries())
      .filter(([_, checked]) => !checked)
      .map(([name]) => ({ label: name, value: name, isChecked: false }));
  }, [filter]);

  const filteredOptions = useMemo(() => {
    let options = availableOptions;

    if (searchValue.length > 0) {
      options = options.filter((o) => o.label.toLowerCase().includes(searchValue.toLowerCase()));
    }

    if (!showAll) {
      options = options.slice(0, maxOptions);
    }

    return options;
  }, [searchValue, availableOptions, showAll]);

  return (
    <>
      <div className="flex flex-col gap-global">
        {selectedOptions.length > 0 && (
          <div
            className="flex flex-row flex-wrap gap-1 p-1"
            role="list"
            aria-label="Selected options"
          >
            {selectedOptions.map((o) => (
              <button
                role="listitem"
                type="button"
                className="tag-container"
                key={o.value}
                onClick={() => {
                  setFilter(new Map(filter.set(o.value, false)));
                  searchInputRef.current?.focus();
                  setLastActionText(`Removed ${o.label}`);
                  setSafeTimeout(() => {
                    setLastActionText("");
                  }, 3000);
                }}
              >
                <Tag
                  color={Colors.pool}
                  size={TagSizes.xs}
                >
                  {o.label}
                  <OutlinedIcon name="close" />
                </Tag>
              </button>
            ))}
          </div>
        )}
        <TextInput
          id={`${id}-search`}
          slotLeft={<OutlinedIcon name="search" />}
          value={searchValue}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setSearchValue(event.target.value);
          }}
          type="search"
          ref={searchInputRef}
          autoComplete="off"
          {...props}
          className="w-full"
          aria-description={lastActionText}
        />
        {filteredOptions.length > 0 && (
          <div
            className="flex flex-row flex-wrap gap-1 p-1"
            role="list"
            aria-label="Available options"
          >
            {filteredOptions.map((o) => (
              <button
                type="button"
                role="listitem"
                className="tag-container"
                key={o.value}
                onClick={() => {
                  setFilter(new Map(filter.set(o.value, true)));
                  searchInputRef.current?.focus();
                  setLastActionText(`Added ${o.label}`);
                  setSafeTimeout(() => {
                    setLastActionText("");
                  }, 3000);
                }}
              >
                <Tag
                  color={Colors.pool}
                  size={TagSizes.xs}
                >
                  <OutlinedIcon name="add" />
                  {o.label}
                </Tag>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
