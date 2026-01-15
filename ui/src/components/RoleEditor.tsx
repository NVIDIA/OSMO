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
  message: string | null;
  isError: boolean;
}

export const RoleEditor: React.FC<RoleEditorProps> = ({ roles, setRoles, label, message, isError }) => {
  const [newRole, setNewRole] = useState(""); // New role being added
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastActionText, setLastActionText] = useState<string>("");

  const addRole = (role: string) => {
    if (!roles.includes(role)) {
      setRoles([...roles, role]);
    }
  };

  const handleAddRole = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedRole = newRole.trim();

    if (!trimmedRole || error) {
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
    <div className="flex flex-col ga">
      <div className="flex flex-col">
        <label>{label}</label>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-labelledby="current-tags"
        >
          {roles.length > 0 ? (
            roles.map((role, index) => (
              <button
                role="listitem"
                className="btn btn-badge"
                key={index}
                onClick={() => handleDeleteRole(role)}
              >
                <Tag
                  color={Colors.tag}
                  size={TagSizes.xs}
                  className="min-h-6 break-all"
                >
                  {role}
                  <OutlinedIcon name="close" />
                </Tag>
              </button>
            ))
          ) : (
            <p className="text-gray-600 h-6">None</p>
          )}
        </div>
      </div>
      <form onSubmit={handleAddRole}>
        <div className="grid grid-cols-[1fr_auto] gap-global">
          <TextInput
            id="new-tag"
            value={newRole}
            onChange={(e) => {
              setNewRole(e.target.value);
            }}
            label="Add New Role"
            errorText={error}
            helperText={error ? undefined : ZERO_WIDTH_SPACE}
            className="w-full"
          />
          <button
            type="submit"
            className="btn mt-5 h-8"
            aria-label="Add Tag"
            aria-disabled={!newRole.trim() || !!error}
          >
            <OutlinedIcon name="add" />
          </button>
        </div>
      </form>
    </div>
  );
};
