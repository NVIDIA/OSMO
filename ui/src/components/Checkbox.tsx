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
import { FilledIcon } from "./Icon";

export const Checkbox = ({
  id,
  checked,
  onChange,
  disabled,
  className,
  checkSize = "small",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { checkSize?: "small" | "large" }) => {
  return (
    <div className={`flex relative ${checkSize === "small" ? "h-6 w-6" : "h-8 w-8"} ${className}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={`
          peer shrink-0
          appearance-none w-full h-full border-1 border-gray-400 rounded-none bg-white
          checked:bg-brand checked:border-0
          disabled:opacity-50 disabled:cursor-not-allowed
          focus-visible:outline-offset-2
        `}
        {...props}
      />
      <FilledIcon
        name="check"
        className={`${checkSize === "small" ? "text-base!" : "text-lg!"} absolute top-0 ${checkSize === "small" ? "left-1/6" : "left-1/4"} hidden peer-checked:block pointer-events-none text-white`}
      />
    </div>
  );
};

export const CheckboxWithLabel = ({
  id,
  checked,
  onChange,
  disabled,
  className,
  containerClassName,
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; containerClassName?: string }) => {
  return (
    <label className={`flex flex-row gap-global items-center hover:cursor-pointer ${containerClassName}`}>
      <Checkbox
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={className}
        {...props}
      />
      {label}
    </label>
  );
};
