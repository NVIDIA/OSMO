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
import React, { useEffect, useState } from "react";

import { OutlinedIcon } from "./Icon";
import { InlineBanner } from "./InlineBanner";
import { Tag, Colors, TagSizes } from "./Tag";
import { TextInput } from "./TextInput";

interface RecordBuilderProps {
  title: string;
  initialData: Record<string, unknown>;
  onSave: (deletedFields: Record<string, unknown>, updatedData: Record<string, unknown>) => void;
  message: string | null;
  isError: boolean;
}

// Get a JSON object and flatten it to prefixes joined by .
const flattenObject = (nestedObj: Record<string, unknown>, prefix = ""): Record<string, unknown> => {
  return Object.entries(nestedObj).reduce((flatObj: Record<string, string>, [key, value]) => {
    const prefixedKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(flatObj, flattenObject(value as Record<string, unknown>, prefixedKey));
    } else {
      flatObj[prefixedKey] = String(value);
    }
    return flatObj;
  }, {});
};

// Reverse from flatten
const unflattenObject = (flatObj: Record<string, unknown>): Record<string, unknown> => {
  const nestedObj: Record<string, unknown> = {};
  Object.entries(flatObj).forEach(([flatKey, value]) => {
    const keyParts = flatKey.split(".");
    let currentLevel: Record<string, unknown> = nestedObj;
    keyParts.forEach((keyPart, index) => {
      if (index === keyParts.length - 1) {
        currentLevel[keyPart] = value;
      } else {
        currentLevel[keyPart] = currentLevel[keyPart] || {};
        currentLevel = currentLevel[keyPart] as Record<string, unknown>;
      }
    });
  });
  return nestedObj;
};

/**
 * This works to set and delete records of data (i.e. Labels) in a flattened fashion.
 * Returns setData and deleteData thorugh a callback.
 * These objects are strings i.e. ["name1.name2.value2, name2.name3.name4"] */
export const RecordBuilder: React.FC<RecordBuilderProps> = ({ title, initialData, onSave, message, isError }) => {
  // State for flattened data, deleted fields
  const [flattenedData, setFlattenedData] = useState(flattenObject(initialData));
  const [deletedFields, setDeletedFields] = useState<Record<string, unknown>>({});
  const [newFieldKey, setNewFieldKey] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [isModified, setIsModified] = useState(false);
  const [lastActionText, setLastActionText] = useState<string>("");

  useEffect(() => {
    setIsModified(JSON.stringify(flattenedData) !== JSON.stringify(initialData));
  }, [flattenedData, initialData]);

  const handleDeleteField = (fieldKey: string, fieldValue: unknown) => {
    const updatedData = { ...flattenedData };
    delete updatedData[fieldKey];
    setFlattenedData(updatedData);
    setDeletedFields({ ...deletedFields, [fieldKey]: fieldValue });
    setLastActionText(`Deleted ${fieldKey}: ${fieldValue as string}`);
  };

  const addField = (fieldKey: string, fieldValue: unknown) => {
    if (!fieldKey || !fieldValue || !fieldKey?.trim() || !String(fieldValue)?.trim()) {
      return;
    }

    setFlattenedData({ ...flattenedData, [fieldKey]: fieldValue });
    delete deletedFields[fieldKey];
    setNewFieldKey("");
    setNewFieldValue("");
    setLastActionText(`Added ${fieldKey}: ${fieldValue as string}`);
  };

  const handleAddField = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    addField(newFieldKey, newFieldValue);
  };

  const handleSaveChanges = () => {
    if (isModified) {
      onSave(deletedFields, unflattenObject(flattenedData));
      setDeletedFields({});
      setNewFieldKey("");
      setNewFieldValue("");
      setIsModified(false);
    }
  };

  const handleUndoChanges = () => {
    if (isModified) {
      setFlattenedData(flattenObject(initialData));
      setDeletedFields({});
      setNewFieldKey("");
      setNewFieldValue("");
      setIsModified(false);
      setLastActionText("Labels reset");
    }
  };

  return (
    <div className="flex flex-col h-full justify-between">
      <div className="flex flex-col gap-6 p-global">
        <div className="flex flex-col">
          <h3
            className="m-0 p-0 text-base"
            id="current-labels"
          >
            Current {title}
          </h3>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-labelledby="current-labels"
          >
            {Object.keys(flattenedData).length > 0 ? (
              Object.entries(flattenedData).map(([key, value], index) => (
                <button
                  role="listitem"
                  className="btn btn-badge"
                  key={index}
                  onClick={() => handleDeleteField(key, value)}
                >
                  <Tag
                    color={Colors.tag}
                    size={TagSizes.xs}
                    className="min-h-6 break-all"
                  >
                    {key}: {value as string}
                    <OutlinedIcon name="close" />
                  </Tag>
                </button>
              ))
            ) : (
              <p className="text-gray-600 h-6">None</p>
            )}
          </div>
        </div>
        <form onSubmit={handleAddField}>
          <div className="grid grid-cols-[1fr_auto] gap-global">
            <fieldset
              aria-label="Add New Label"
              className="w-full"
            >
              <div className="grid grid-cols-[1fr_1fr] gap-global w-full">
                <TextInput
                  id="field"
                  value={newFieldKey}
                  onChange={(e) => {
                    setNewFieldKey(e.target.value);
                  }}
                  label="Field"
                  className="w-full"
                />
                <TextInput
                  id="value"
                  value={newFieldValue}
                  onChange={(e) => {
                    setNewFieldValue(e.target.value);
                  }}
                  label="Value"
                  className="w-full"
                />
              </div>
            </fieldset>
            <button
              type="submit"
              className="btn mt-5 h-8"
              aria-label="Add Label"
              aria-disabled={!newFieldKey.trim() || !newFieldValue.trim()}
            >
              <OutlinedIcon name="add" />
            </button>
          </div>
        </form>
        <div className="flex flex-col">
          <h3
            className="m-0 p-0 text-base"
            id="deleted-labels"
          >
            Deleted {title}
          </h3>
          <div className="flex flex-wrap gap-1">
            {Object.keys(deletedFields).length > 0 ? (
              Object.entries(deletedFields).map(([field, value], index) => (
                <button
                  role="listitem"
                  className="btn btn-badge"
                  key={index}
                  onClick={() => {
                    addField(field, value);
                  }}
                >
                  <Tag
                    color={Colors.tag}
                    size={TagSizes.xs}
                  >
                    {field}: {value as string}
                    <OutlinedIcon name="add" />
                  </Tag>
                </button>
              ))
            ) : (
              <p className="text-gray-600">None</p>
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
            onClick={handleUndoChanges}
            className="btn btn-secondary"
            aria-disabled={!isModified}
          >
            <OutlinedIcon name="undo" />
            Reset
          </button>
          <button
            onClick={handleSaveChanges}
            className="btn btn-primary"
            aria-disabled={!isModified}
          >
            <OutlinedIcon name="check" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
