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

import { InlineBanner } from "./InlineBanner";

// Helper function to set nested values in an object
const setNestedValue = (obj: Record<string, unknown>, path: string[], value: unknown) => {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!(path[i]! in current)) {
      current[path[i]!] = {};
    }
    current = current[path[i]!] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
};
// Function to compare old and new objects recursively to find differences
const compareObjects = (oldObj: Record<string, unknown>, newObj: Record<string, unknown>) => {
  const deletedFields: string[] = [];

  /**
   * Building updated JSON data based on the changes in the record
   *
   * i.e.:
   *  set_metadata: {
   *    old_key: {
   *      old_key: old_value
   *      new_key: new_value
   *    }
   *  }
   *  should only return:
   *
   *  set_metadata: {
   *    old_key: {
   *       new_key: new_value
   *   }
   *  }
   *
   *  or just the names of deleted fields with .'s as object separators
   */
  const updatedData: Record<string, unknown> = {};

  const compareRecursive = (
    oldData: Record<string, unknown>,
    newData: Record<string, unknown>,
    currentPath: string[] = [],
  ) => {
    // Check for deleted fields
    for (const key in oldData) {
      const newPath = [...currentPath, key];
      if (!(key in newData)) {
        deletedFields.push(newPath.join("."));
      } else if (
        typeof oldData[key] === "object" &&
        oldData[key] !== null &&
        typeof newData[key] === "object" &&
        newData[key] !== null
      ) {
        // Recursively compare nested objects
        compareRecursive(oldData[key] as Record<string, unknown>, newData[key] as Record<string, unknown>, newPath);
      } else if (oldData[key] !== newData[key]) {
        // Record updated values
        setNestedValue(updatedData, newPath, newData[key]);
      }
    }

    // Check for new fields
    for (const key in newData) {
      const newPath = [...currentPath, key];
      if (!(key in oldData)) {
        setNestedValue(updatedData, newPath, newData[key]);
      }
    }
  };

  compareRecursive(oldObj, newObj);
  return { deletedFields, updatedData };
};

interface JSONEditorProps extends React.HTMLAttributes<HTMLTextAreaElement> {
  initialData: Record<string, unknown>;
  onSave: (deletedFields: string[], updatedData: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
  onFormatError: (error: string | null) => void;
  message: string | null;
  isError: boolean;
}

export const JSONEditor: React.FC<JSONEditorProps> = ({
  initialData,
  onSave,
  onCancel,
  onFormatError,
  message,
  isError,
  ...props
}) => {
  // Managing JSON data, edit mode, and errors
  const [jsonData, setJsonData] = useState<string>("");
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    setJsonData(JSON.stringify(initialData, null, 2));
  }, [initialData]);

  const handleSaveChanges = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    onFormatError(null);

    try {
      const newData: Record<string, unknown> = JSON.parse(jsonData) as Record<string, unknown>;
      // Compare old and new data to find deleted fields and updates
      const { deletedFields, updatedData } = compareObjects(initialData, newData);

      if (deletedFields.length > 0 || Object.keys(updatedData).length > 0) {
        // Call the onSave callback with the changes
        const success = await onSave(deletedFields, updatedData);
        if (success) {
          setIsEditMode(false);
        }
      } else {
        onFormatError("No changes to save");
      }
    } catch (e) {
      onFormatError("Invalid JSON format");
    }
  };

  return (
    <form
      onSubmit={handleSaveChanges}
      className="w-full h-full"
    >
      <div className="flex flex-col gap-global h-full w-full">
        <div className="w-full h-full p-global">
          {isEditMode ? (
            <textarea
              aria-label="JSON Editor"
              id="json-editor"
              className="w-full h-full outline-none"
              value={jsonData}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                setJsonData(e.target.value);
                onFormatError(null);
              }}
              autoFocus
              {...props}
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words w-full h-full opacity-60">{jsonData}</pre>
          )}
        </div>
        <div className="flex flex-col">
          <InlineBanner status={!message ? "none" : isError ? "error" : "success"}>{message}</InlineBanner>
          <div className="modal-footer">
            {isEditMode ? (
              <>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={onCancel}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                >
                  Save
                </button>
              </>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => setIsEditMode(true)}
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
};
