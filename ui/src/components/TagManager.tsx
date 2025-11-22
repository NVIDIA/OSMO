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
import React, { useEffect, useMemo, useState } from "react";

import { ZERO_WIDTH_SPACE } from "~/utils/string";

import { OutlinedIcon } from "./Icon";
import { InlineBanner } from "./InlineBanner";
import { Tag, Colors, TagSizes } from "./Tag";
import { TextInput } from "./TextInput";

const isReservedTag = (tag: string) => tag === "latest" || !Number.isNaN(Number(tag));

interface TagManagerProps {
  currentTags: string[];
  onSave: (setTags: string[], deleteTags: string[]) => void;
  dropdownOptions?: string[];
  message: string | null;
  isError: boolean;
}

export const TagManager: React.FC<TagManagerProps> = ({ currentTags, onSave, message, isError }) => {
  const [newTag, setNewTag] = useState(""); // New tag being added
  const [deletedTags, setDeletedTags] = useState<string[]>([]);
  const [addedTags, setAddedTags] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [lastActionText, setLastActionText] = useState<string>("");

  useEffect(() => {
    const trimmedTag = newTag.trim();

    if (trimmedTag.length && isReservedTag(trimmedTag)) {
      setError("Improper use of reserved tag");
    } else {
      setError(undefined);
    }
  }, [newTag]);

  useEffect(() => {
    setDeletedTags([]);
    setAddedTags([]);
  }, [currentTags]);

  const addTag = (tag: string) => {
    if (!currentTags.includes(tag) && !addedTags.includes(tag)) {
      setAddedTags([...addedTags, tag]);
    }
    setDeletedTags(deletedTags.filter((t) => t !== tag));
  };

  const handleAddTag = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const trimmedTag = newTag.trim();

    if (!trimmedTag || error) {
      return;
    }

    addTag(trimmedTag);
    setNewTag("");
    setLastActionText(`Added ${trimmedTag}`);
  };

  const handleDeleteTag = (tagToDelete: string) => {
    if (isReservedTag(tagToDelete)) {
      setLastActionText(`Cannot delete reserved tag: ${tagToDelete}`);
      return;
    }
    setDeletedTags([...deletedTags, tagToDelete]);
    setAddedTags(addedTags.filter((tag) => tag !== tagToDelete));
    setLastActionText(`Deleted ${tagToDelete}`);
  };

  const handleSave = () => {
    if (error) {
      return;
    }

    onSave(addedTags, deletedTags);
  };

  const handleUndo = () => {
    setDeletedTags([]);
    setAddedTags([]);
    setNewTag("");
    setLastActionText("Tags reset");
  };

  const displayTags = useMemo(() => {
    // Use a Set to ensure uniqueness
    const tagsSet = new Set<string>([
      ...(currentTags?.filter((tag: string) => !deletedTags?.includes(tag)) || []),
      ...(addedTags || []),
    ]);
    return Array.from(tagsSet);
  }, [currentTags, deletedTags, addedTags]);

  return (
    <div className="flex flex-col h-full justify-between">
      <div className="flex flex-col gap-6 p-global">
        <div className="flex flex-col">
          <h3
            className="m-0 p-0 text-base"
            id="current-tags"
          >
            Current Tags
          </h3>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-labelledby="current-tags"
          >
            {displayTags.length > 0 ? (
              displayTags.map((tag, index) => (
                <button
                  role="listitem"
                  className="btn btn-badge"
                  key={index}
                  onClick={() => handleDeleteTag(tag)}
                >
                  <Tag
                    color={Colors.tag}
                    size={TagSizes.xs}
                    className="min-h-6 break-all"
                  >
                    {tag}
                    {!isReservedTag(tag) ? <OutlinedIcon name="close" /> : undefined}
                  </Tag>
                </button>
              ))
            ) : (
              <p className="text-gray-600 h-6">None</p>
            )}
          </div>
        </div>
        <form onSubmit={handleAddTag}>
          <div className="grid grid-cols-[1fr_auto] gap-global">
            <TextInput
              id="new-tag"
              value={newTag}
              onChange={(e) => {
                setNewTag(e.target.value);
              }}
              label="Add New Tag"
              errorText={error}
              helperText={error ? undefined : ZERO_WIDTH_SPACE}
              className="w-full"
            />
            <button
              type="submit"
              className="btn mt-5 h-8"
              aria-label="Add Tag"
              aria-disabled={!newTag.trim() || !!error}
            >
              <OutlinedIcon name="add" />
            </button>
          </div>
        </form>
        <div className="flex flex-col">
          <h3
            className="m-0 p-0 text-base"
            id="deleted-tags"
          >
            Deleted Tags
          </h3>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-labelledby="deleted-tags"
          >
            {deletedTags.length > 0 ? (
              deletedTags.map((tag, index) => (
                <button
                  role="listitem"
                  className="btn btn-badge"
                  key={index}
                  onClick={() => {
                    addTag(tag);
                  }}
                >
                  <Tag
                    color={Colors.tag}
                    size={TagSizes.xs}
                  >
                    {tag}
                    <OutlinedIcon name="add" />
                  </Tag>
                </button>
              ))
            ) : (
              <p className="text-gray-600 h-6">None</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <InlineBanner status={isError ? "error" : message ? "success" : "none"}>{message}</InlineBanner>
        <p
          aria-live="polite"
          className="sr-only"
        >
          {lastActionText}
        </p>
        <div className="modal-footer">
          <button
            onClick={handleUndo}
            className="btn btn-secondary"
            aria-disabled={!addedTags.length && !deletedTags.length}
          >
            <OutlinedIcon name="undo" />
            Reset
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
            aria-disabled={!addedTags.length && !deletedTags.length}
          >
            <OutlinedIcon name="check" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
