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
interface ViewToggleButtonProps extends React.InputHTMLAttributes<HTMLInputElement> {
  children: React.ReactNode;
}

export const ViewToggleButton = ({ checked, onChange, children, ...props }: ViewToggleButtonProps) => {
  return (
    <label
      className={`flex items-center gap-1 btn ${checked ? "btn-primary z-10" : "btn-tertiary border-1 border-border"} rounded-none`}
    >
      <input
        type="radio"
        className="appearance-none w-0 h-0 mr-[-0.25rem]"
        checked={checked}
        onChange={onChange}
        {...props}
      />
      {children}
    </label>
  );
};
