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
export const Spinner = ({
  size = "large",
  description,
  className,
}: {
  size?: "small" | "medium" | "large" | "button";
  description?: string;
  className?: string;
}) => {
  const sizeMap = {
    button: "h-4 w-4",
    small: "h-8 w-8",
    medium: "h-12 w-12",
    large: "h-16 w-16",
  };

  return (
    <div className="flex flex-col items-center justify-center gap-global">
      <div
        className={`animate-spin rounded-full ${sizeMap[size]} border-t-3 border-b-3 ${className ?? "border-brand"}`}
      ></div>
      {description && (
        <div
          className="text-sm"
          role="status"
          aria-label={description ?? "Loading..."}
        >
          {description}
        </div>
      )}
    </div>
  );
};
