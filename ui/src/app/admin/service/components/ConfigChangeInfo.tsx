//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import { InlineBanner } from "~/components/InlineBanner";
import { Colors, Tag } from "~/components/Tag";
import { type ServiceConfigHistoryItem } from "~/models/config/service-config";

interface ConfigChangeInfoProps {
  config: ServiceConfigHistoryItem;
}

export const ConfigChangeInfo = ({ config }: ConfigChangeInfoProps) => (
  <InlineBanner
    status="info"
    className="items-start"
  >
    <div className="flex flex-col">
      <div className="flex flex-row gap-global">
        <p>
          Created{" "}
          {config.username && (
            <span>
              by <strong>{config.username}</strong>
            </span>
          )}{" "}
          on{" "}
          <strong>
            {config.created_at.toLocaleString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </strong>
        </p>
        <div className="flex flex-row gap-1">
          {config.tags?.map((tag) => (
            <Tag
              key={tag}
              color={Colors.tag}
            >
              {tag}
            </Tag>
          ))}
        </div>
      </div>
      <p>
        <i>{config.description}</i>
      </p>
    </div>
  </InlineBanner>
);
