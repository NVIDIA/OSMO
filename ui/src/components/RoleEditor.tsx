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
import React, { useMemo, useState } from "react";

import { ZERO_WIDTH_SPACE } from "~/utils/string";

import { OutlinedIcon } from "./Icon";
import { Tag, Colors, TagSizes } from "./Tag";
import { TextInput } from "./TextInput";

interface RoleEditorProps {
  roles: string[];
  setRoles: (roles: string[]) => void;
  label: string;
  entityLabel: string;
  message: string | null;
  isError: boolean;
}

export const RoleEditor: React.FC<RoleEditorProps> = ({ roles, setRoles, label, entityLabel, message, isError }) => {
  const [newRole, setNewRole] = useState(""); // New role being added
  const [lastActionText, setLastActionText] = useState<string>("");
  const [isAdding, setIsAdding] = useState(false);

  const addRole = (role: string) => {
    if (!roles.includes(role)) {
      setRoles([...roles, role]);
    }
  };

  const handleAddRole = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedRole = newRole.trim();

    if (!trimmedRole) {
      return;
    }

    addRole(trimmedRole);
    setNewRole("");
    setLastActionText(`Added ${trimmedRole}`);
  };

  const handleDeleteRole = (roleToDelete: string) => {
    setRoles(roles.filter((role) => role !== roleToDelete));
    setLastActionText(`Deleted ${roleToDelete}`);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <label>{label}</label>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-labelledby="current-tags"
        >
          {roles.length > 0 &&
            roles.map((role, index) => (
              <button
                role="listitem"
                className="btn btn-badge"
                key={index}
                onClick={() => handleDeleteRole(role)}
                type="button"
              >
                <Tag
                  color={Colors.tag}
                  size={TagSizes.xs}
                  className="h-8 break-all"
                >
                  {role}
                  <OutlinedIcon name="close" />
                </Tag>
              </button>
            ))}
          {isAdding ? (
            <TextInput
              id="new-role"
              value={newRole}
              onChange={(e) => {
                setNewRole(e.target.value);
              }}
              aria-label={entityLabel}
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(!isAdding)}
              className="btn btn-badge"
              aria-label="Add"
            >
              <Tag
                color={Colors.tag}
                size={TagSizes.xs}
                className="h-8"
              >
                <OutlinedIcon name="add" />
              </Tag>
            </button>
          )}
        </div>
      </div>
      <p
        aria-live="polite"
        className="sr-only"
      >
        {lastActionText}
      </p>
    </>
  );
};
