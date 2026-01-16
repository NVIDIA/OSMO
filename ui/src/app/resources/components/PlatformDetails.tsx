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

import { PageError } from "~/components/PageError";
import { Tag, Colors } from "~/components/Tag";

interface PlatformDetailsProps {
  name: string;
  showLoadError?: boolean;
  hostNetwork?: boolean | null;
  privileged?: boolean | null;
  defaultMounts?: string[] | null;
  allowedMounts?: string[] | null;
  className?: string;
  children?: React.ReactNode;
}

export const PlatformDetails = ({
  name,
  showLoadError,
  hostNetwork,
  privileged,
  defaultMounts,
  allowedMounts,
  className = "",
  children,
}: PlatformDetailsProps) => {
  return (
    <section
      aria-labelledby="platform-details-title"
      className="card w-full flex flex-col body-component xs:overflow-y-auto"
    >
      <h2
        id="platform-details-title"
        className="brand-header px-global flex flex-row justify-between items-center gap-global"
      >
        {name}
        <Tag
          className="inline-block"
          color={Colors.platform}
        >
          Platform
        </Tag>
      </h2>
      {showLoadError ? (
        <PageError
          title="Failed to Fetch Platform"
          errorMessage={`Platform ${name} not found`}
        />
      ) : (
        <div className="flex flex-col h-full">
          {children}
          <div className="flex flex-row gap-global p-global justify-around">
            <p>
              <strong>Host Network Allowed:</strong> {hostNetwork ? "True" : "False"}
            </p>
            <p>
              <strong>Privileged Mode Allowed:</strong> {privileged ? "True" : "False"}
            </p>
          </div>
          <div className={`grid sm:grid-cols-2 gap-global px-global pb-global sm:h-full ${className}`}>
            <div className="card p-0 h-full">
              <h3
                className="body-header text-base text-center px-global"
                id="default-mounts"
              >
                Default Mounts
              </h3>
              {defaultMounts?.length ? (
                <ul
                  aria-labelledby="default-mounts"
                  className="p-global"
                >
                  {defaultMounts?.map((mount) => (
                    <li key={mount}>{mount}</li>
                  ))}
                </ul>
              ) : (
                <p className="p-global">None</p>
              )}
            </div>
            <div className="card p-0 h-full">
              <h3
                className="body-header text-base text-center px-global"
                id="allowed-mounts"
              >
                Allowed Mounts
              </h3>
              {allowedMounts?.length ? (
                <ul
                  aria-labelledby="allowed-mounts"
                  className="p-global"
                >
                  {allowedMounts?.map((mount) => (
                    <li key={mount}>{mount}</li>
                  ))}
                </ul>
              ) : (
                <p className="p-global">None</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
