//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at
//
//http://www.apache.org/licenses/LICENSE-2.0
//
//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.
//
//SPDX-License-Identifier: Apache-2.0
import { useCallback } from "react";

import { Colors, Tag } from "~/components/Tag";
import { type ServiceConfig } from "~/models/config/service-config";

const highlightClass = "bg-yellow-100";

export const ServiceConfigOverview = ({
  serviceConfig,
  previousConfig,
  isShowingJSON,
}: {
  serviceConfig: ServiceConfig;
  previousConfig?: ServiceConfig;
  isShowingJSON: boolean;
}) => {
  const isChanged = useCallback(
    (getValue: (config: ServiceConfig) => unknown): boolean => {
      if (!previousConfig) {
        return false;
      }

      const current = getValue(serviceConfig);
      const previous = getValue(previousConfig);

      if ((previous === null || current === null) && previous !== current) {
        return true;
      }
      return JSON.stringify(current) !== JSON.stringify(previous);
    },
    [previousConfig, serviceConfig],
  );

  if (isShowingJSON) {
    return <pre className="p-global text-sm font-mono">{JSON.stringify(serviceConfig, null, 2)}</pre>;
  }
  return (
    <div className="flex flex-col gap-global p-global w-full h-full">
      <dl
        aria-label="General Settings"
        className="grid grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto_1fr] gap-global"
      >
        <dt>Service Base URL</dt>
        <dd>
          <span className={isChanged((config) => config.service_base_url) ? highlightClass : ""}>
            {serviceConfig.service_base_url}
          </span>
        </dd>
        <dt>Max Pod Restart Limit</dt>
        <dd>
          <span className={isChanged((config) => config.max_pod_restart_limit) ? highlightClass : ""}>
            {serviceConfig.max_pod_restart_limit}
          </span>
        </dd>
        <dt>Agent Queue Size</dt>
        <dd>
          <span className={isChanged((config) => config.agent_queue_size) ? highlightClass : ""}>
            {serviceConfig.agent_queue_size}
          </span>
        </dd>
        <dt>Issuer</dt>
        <dd>
          <span className={isChanged((config) => config.service_auth.issuer) ? highlightClass : ""}>
            {serviceConfig.service_auth.issuer}
          </span>
        </dd>
        <dt>Audience</dt>
        <dd>
          <span className={isChanged((config) => config.service_auth.audience) ? highlightClass : ""}>
            {serviceConfig.service_auth.audience}
          </span>
        </dd>
        <dt>User Roles</dt>
        <dd>
          <div
            className={`flex flex-wrap gap-1 ${isChanged((config) => config.service_auth.user_roles) ? highlightClass : ""}`}
          >
            {serviceConfig.service_auth.user_roles.map((role) => (
              <Tag
                color={Colors.tag}
                key={role}
                className="inline-block"
              >
                {role}
              </Tag>
            ))}
          </div>
        </dd>
        <dt>Ctrl Roles</dt>
        <dd>
          <div
            className={`flex flex-wrap gap-1 ${isChanged((config) => config.service_auth.ctrl_roles) ? highlightClass : ""}`}
          >
            {serviceConfig.service_auth.ctrl_roles.map((role) => (
              <Tag
                color={Colors.pool}
                key={role}
                className="inline-block"
              >
                {role}
              </Tag>
            ))}
          </div>
        </dd>
        <dt>Max Token Duration</dt>
        <dd>
          <span className={isChanged((config) => config.service_auth.max_token_duration) ? highlightClass : ""}>
            {serviceConfig.service_auth.max_token_duration}
          </span>
        </dd>
        <dt>CLI Latest Version</dt>
        <dd>
          <span className={isChanged((config) => config.cli_config.latest_version) ? highlightClass : ""}>
            {serviceConfig.cli_config.latest_version ?? "-"}
          </span>
        </dd>
        <dt>CLI Min Supported Version</dt>
        <dd>
          <span className={isChanged((config) => config.cli_config.min_supported_version) ? highlightClass : ""}>
            {serviceConfig.cli_config.min_supported_version ?? "-"}
          </span>
        </dd>
        <dt>Device Client ID</dt>
        <dd>
          <span
            className={isChanged((config) => config.service_auth.login_info.device_client_id) ? highlightClass : ""}
          >
            {serviceConfig.service_auth.login_info.device_client_id ?? "-"}
          </span>
        </dd>
        <dt>Browser Client ID</dt>
        <dd>
          <span
            className={isChanged((config) => config.service_auth.login_info.browser_client_id) ? highlightClass : ""}
          >
            {serviceConfig.service_auth.login_info.browser_client_id ?? "-"}
          </span>
        </dd>
        <dt>Keys</dt>
        <dd className="lg:col-span-3">
          <ul className={`list-none ${isChanged((config) => config.service_auth.keys) ? highlightClass : ""}`}>
            {Object.entries(serviceConfig.service_auth.keys).map(([key, _value]) => {
              return (
                <li
                  className="flex flex-row gap-1"
                  key={key}
                >
                  {key}
                  {key === serviceConfig.service_auth.active_key ? (
                    <Tag
                      className="inline-block"
                      color={Colors.tag}
                    >
                      Active
                    </Tag>
                  ) : undefined}
                </li>
              );
            })}
          </ul>
        </dd>
        <dt>Device Endpoint</dt>
        <dd className="lg:col-span-3">
          <span className={isChanged((config) => config.service_auth.login_info.device_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.device_endpoint ?? "-"}
          </span>
        </dd>
        <dt>Browser Endpoint</dt>
        <dd className="lg:col-span-3">
          <span
            className={isChanged((config) => config.service_auth.login_info.browser_endpoint) ? highlightClass : ""}
          >
            {serviceConfig.service_auth.login_info.browser_endpoint ?? "-"}
          </span>
        </dd>
        <dt>Token Endpoint</dt>
        <dd className="lg:col-span-3">
          <span className={isChanged((config) => config.service_auth.login_info.token_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.token_endpoint ?? "-"}
          </span>
        </dd>
        <dt>Logout Endpoint</dt>
        <dd className="lg:col-span-3">
          <span className={isChanged((config) => config.service_auth.login_info.logout_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.logout_endpoint ?? "-"}
          </span>
        </dd>
      </dl>
    </div>
  );
};
