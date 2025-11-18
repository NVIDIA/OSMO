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
"use client";

import { type ReactNode } from "react";

import Link from "next/link";

import { FilledIcon } from "./Icon";

const Breadcrumbs = ({ segments }: { segments: ReactNode[] }) => {
  const count = segments.length;
  return (
    <div className="flex flex-row gap-global items-center breadcrumbs">
      {segments.map((segment, index) =>
        index < count - 1 ? (
          <Link
            href={`/${segments.slice(0, index + 1).join("/")}`}
            key={index}
            className="flex flex-row gap-1 items-center capitalize"
          >
            {segment}
            <FilledIcon
              name="chevron_right"
              className="text-base opacity-50"
            />
          </Link>
        ) : (
          <div
            key={index}
            className="capitalize font-semibold"
          >
            {segment}
          </div>
        ),
      )}
    </div>
  );
};

export default Breadcrumbs;
