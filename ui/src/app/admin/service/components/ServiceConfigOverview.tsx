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
import { Colors, Tag } from "~/components/Tag";
import { type ServiceConfig } from "~/models/config/service-config";

const highlightClass = "bg-yellow-100";

type GetValue = (config: ServiceConfig) => unknown;

export const ServiceConfigOverview = ({
  serviceConfig,
  previousConfig,
  isShowingJSON,
}: {
  serviceConfig: ServiceConfig;
  previousConfig?: ServiceConfig;
  isShowingJSON: boolean;
}) => {
  const Diff = ({
    getValue,
    children,
    className,
  }: {
    getValue: GetValue;
    children: React.ReactNode;
    className?: string;
  }) => {
    const isChanged = (getValue: GetValue): boolean => {
      if (!previousConfig) {
        return false;
      }

      const current = getValue(serviceConfig);
      const previous = getValue(previousConfig);

      if ((previous === null || current === null) && previous !== current) {
        return true;
      }
      return JSON.stringify(current) !== JSON.stringify(previous);
    };

    return (
      <div
        className={`inline-flex flex-row flex-wrap gap-1 ${className} ${isChanged(getValue) ? highlightClass : ""}`}
        aria-live={isChanged(getValue) ? "polite" : undefined}
      >
        {children}
      </div>
    );
  };

  if (isShowingJSON) {
    return (
      <textarea
        className="p-global text-sm font-mono w-full h-full focus:outline-none"
        value={JSON.stringify(serviceConfig, null, 2)}
        readOnly
      />
    );
  }

  return (
    <div className="flex flex-col gap-global p-global w-full h-full">
      <dl
        aria-label="General Settings"
        className="grid grid-cols-[auto_1fr] lg:grid-cols-[auto_1fr_auto_1fr] gap-global"
      >
        <dt>Service Base URL</dt>
        <dd>
          <Diff getValue={(config) => config.service_base_url}>{serviceConfig.service_base_url}</Diff>
        </dd>
        <dt>Max Pod Restart Limit</dt>
        <dd>
          <Diff getValue={(config) => config.max_pod_restart_limit}>{serviceConfig.max_pod_restart_limit}</Diff>
        </dd>
        <dt>Agent Queue Size</dt>
        <dd>
          <Diff getValue={(config) => config.agent_queue_size}>{serviceConfig.agent_queue_size}</Diff>
        </dd>
        <dt>Issuer</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.issuer}>{serviceConfig.service_auth.issuer}</Diff>
        </dd>
        <dt>Audience</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.audience}>{serviceConfig.service_auth.audience}</Diff>
        </dd>
        <dt>User Roles</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.user_roles}>
            {serviceConfig.service_auth.user_roles.map((role) => (
              <Tag
                color={Colors.tag}
                key={role}
                className="inline-block"
              >
                {role}
              </Tag>
            ))}
          </Diff>
        </dd>
        <dt>Ctrl Roles</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.ctrl_roles}>
            {serviceConfig.service_auth.ctrl_roles.map((role) => (
              <Tag
                color={Colors.pool}
                key={role}
                className="inline-block"
              >
                {role}
              </Tag>
            ))}
          </Diff>
        </dd>
        <dt>Max Token Duration</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.max_token_duration}>
            {serviceConfig.service_auth.max_token_duration}
          </Diff>
        </dd>
        <dt>CLI Latest Version</dt>
        <dd>
          <Diff getValue={(config) => config.cli_config.latest_version}>
            {serviceConfig.cli_config.latest_version ?? "-"}
          </Diff>
        </dd>
        <dt>CLI Min Supported Version</dt>
        <dd>
          <Diff getValue={(config) => config.cli_config.min_supported_version}>
            {serviceConfig.cli_config.min_supported_version ?? "-"}
          </Diff>
        </dd>
        <dt>Device Client ID</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.login_info.device_client_id}>
            {serviceConfig.service_auth.login_info.device_client_id ?? "-"}
          </Diff>
        </dd>
        <dt>Browser Client ID</dt>
        <dd>
          <Diff getValue={(config) => config.service_auth.login_info.browser_client_id}>
            {serviceConfig.service_auth.login_info.browser_client_id ?? "-"}
          </Diff>
        </dd>
        <dt>Keys</dt>
        <dd className="lg:col-span-3">
          <Diff getValue={(config) => config.service_auth.keys}>
            <ul className="list-none">
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
          </Diff>
        </dd>
        <dt>Device Endpoint</dt>
        <dd className="lg:col-span-3">
          <Diff getValue={(config) => config.service_auth.login_info.device_endpoint}>
            {serviceConfig.service_auth.login_info.device_endpoint ?? "-"}
          </Diff>
        </dd>
        <dt>Browser Endpoint</dt>
        <dd className="lg:col-span-3">
          <Diff getValue={(config) => config.service_auth.login_info.browser_endpoint}>
            {serviceConfig.service_auth.login_info.browser_endpoint ?? "-"}
          </Diff>
        </dd>
        <dt>Token Endpoint</dt>
        <dd className="lg:col-span-3">
          <Diff getValue={(config) => config.service_auth.login_info.token_endpoint}>
            {serviceConfig.service_auth.login_info.token_endpoint ?? "-"}
          </Diff>
        </dd>
        <dt>Logout Endpoint</dt>
        <dd className="lg:col-span-3">
          <Diff getValue={(config) => config.service_auth.login_info.logout_endpoint}>
            {serviceConfig.service_auth.login_info.logout_endpoint ?? "-"}
          </Diff>
        </dd>
      </dl>
    </div>
  );
};
