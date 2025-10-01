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
import { forwardRef } from "react";
import { type InputHTMLAttributes } from "react";

export const TextInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
    id: string;
    label?: string;
    value: string;
    errorText?: string;
    helperText?: string;
    type?: string;
    slotLeft?: React.ReactNode;
    required?: boolean;
    containerClassName?: string;
    readOnly?: boolean;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  }
>(
  (
    {
      id,
      type = "text",
      label,
      value,
      errorText,
      helperText,
      onChange,
      slotLeft,
      className,
      containerClassName,
      required = false,
      readOnly = false,
      ...props
    },
    ref,
  ) => {
    return (
      <div className={`flex flex-col gap-1 ${containerClassName}`}>
        {label && (
          <label htmlFor={id}>
            {label} {required && <span className="text-red-600">*</span>}
          </label>
        )}
        <div className="relative">
          {slotLeft && <div className="absolute left-2 top-1/2 -translate-y-1/2 text-sm">{slotLeft}</div>}
          <input
            ref={ref}
            required={required}
            id={id}
            type={type}
            value={value}
            onChange={onChange}
            aria-describedby={errorText ? `${id}-error` : helperText ? `${id}-helper` : undefined}
            readOnly={readOnly}
            className={`min-h-8 ${className} ${slotLeft ? "pl-8" : ""}`}
            {...props}
          />
        </div>
        {errorText && (
          <p
            className="text-red-600 text-xs"
            id={`${id}-error`}
          >
            {errorText}
          </p>
        )}
        {helperText && (
          <p
            className="text-gray-800 italic text-xs"
            id={`${id}-helper`}
          >
            {helperText}
          </p>
        )}
      </div>
    );
  },
);

TextInput.displayName = "TextInput";
