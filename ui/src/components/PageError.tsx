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
import { OutlinedIcon } from "./Icon";
import { InlineBanner } from "./InlineBanner";

export const PageError = ({
  title,
  errorMessage,
  subText,
  subTextTitle,
  children,
  size = "lg",
  icon = "cloud_off",
  className = "",
}: {
  title: string;
  errorMessage?: string;
  subText?: string;
  subTextTitle?: string;
  children?: React.ReactNode;
  size?: "md" | "lg";
  icon?: string;
  className?: string;
}) => {
  return (
    <div
      className="h-full w-full flex flex-col"
      role="alert"
    >
      {subText && (
        <InlineBanner status="error">
          <div className="flex flex-col gap-global">
            {subTextTitle && <p>{subTextTitle}</p>}
            <p>{subText}</p>
          </div>
        </InlineBanner>
      )}
      <div className={`grow flex flex-col justify-center items-center text-center gap-global p-4 ${className}`}>
        <OutlinedIcon
          name={icon}
          className={`${size === "lg" ? "text-6xl!" : "text-4xl!"}`}
        />
        <p className={`p-0 font-bold ${size === "lg" ? "text-2xl" : "text-xl"}`}>{title}</p>
        <p>{errorMessage ?? "Unknown error occurred"}</p>
        {children}
      </div>
    </div>
  );
};
