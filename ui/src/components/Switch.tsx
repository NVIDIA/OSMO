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
export const Switch = ({
  id,
  size = "medium",
  labelPosition = "left",
  label,
  checked,
  onChange,
  className = "",
  disabled = false,
  title,
}: {
  id: string;
  size?: "small" | "medium" | "large";
  labelPosition?: "left" | "right";
  label?: string;
  checked: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) => {
  const labelSize = size === "small" ? "xs" : size === "medium" ? "sm" : "lg";
  const switchClass =
    size === "small"
      ? "w-10 h-5 after:w-4 after:h-4"
      : size === "medium"
        ? "w-14 h-8 after:w-6 after:h-6"
        : "w-16 h-10 after:w-8 after:h-8";
  const switchMove = !checked ? "" : size === "small" ? "after:translate-x-4" : "after:translate-x-6";

  const getLabel = () => {
    if (!label) {
      return null;
    }

    return (
      <label
        className={`text-${labelSize} leading-${labelSize}`}
        htmlFor={id}
      >
        {label}
      </label>
    );
  };

  return (
    <div className={`flex items-center group gap-global w-min ${className}`}>
      {labelPosition === "left" && getLabel()}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className="w-full h-full peer rounded-full"
        onClick={() => onChange && onChange(!checked)}
        disabled={disabled}
        title={title}
      >
        <span
          className={`flex items-center flex-shrink-0 p-1 rounded-full duration-300 ease-in-out after:bg-white after:rounded-full after:shadow-md after:duration-300 ${switchClass} ${!checked ? " bg-gray-200 " : " bg-brand"} ${switchMove} ${disabled ? " opacity-70" : ""}`}
        ></span>
      </button>
      {labelPosition === "right" && getLabel()}
    </div>
  );
};
