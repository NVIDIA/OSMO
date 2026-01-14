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
import { Fragment, useCallback } from "react";

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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-global p-global w-full h-full">
      <section
        aria-labelledby="general-title"
        className="data-section"
        aria-label="General Settings"
      >
        <h3 id="general-title">General</h3>
        <dl aria-labelledby="general-title">
          <dt>Service Base URL</dt>
          <dd className={isChanged((config) => config.service_base_url) ? highlightClass : ""}>
            {serviceConfig.service_base_url}
          </dd>
          <dt>Max Pod Restart Limit</dt>
          <dd className={isChanged((config) => config.max_pod_restart_limit) ? highlightClass : ""}>
            {serviceConfig.max_pod_restart_limit}
          </dd>
          <dt>Agent Queue Size</dt>
          <dd className={isChanged((config) => config.agent_queue_size) ? highlightClass : ""}>
            {serviceConfig.agent_queue_size}
          </dd>
          <dt>Issuer</dt>
          <dd className={isChanged((config) => config.service_auth.issuer) ? highlightClass : ""}>
            {serviceConfig.service_auth.issuer}
          </dd>
          <dt>Audience</dt>
          <dd className={isChanged((config) => config.service_auth.audience) ? highlightClass : ""}>
            {serviceConfig.service_auth.audience}
          </dd>
          <dt>User Roles</dt>
          <dd className={isChanged((config) => config.service_auth.user_roles) ? highlightClass : ""}>
            <div className="flex flex-wrap gap-1">
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
          <dd className={isChanged((config) => config.service_auth.ctrl_roles) ? highlightClass : ""}>
            <div className="flex flex-wrap gap-1">
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
          <dd className={isChanged((config) => config.service_auth.max_token_duration) ? highlightClass : ""}>
            {serviceConfig.service_auth.max_token_duration}
          </dd>
          <dt>Device Client ID</dt>
          <dd className={isChanged((config) => config.service_auth.login_info.device_client_id) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.device_client_id ?? "-"}
          </dd>
          <dt>Browser Client ID</dt>
          <dd className={isChanged((config) => config.service_auth.login_info.browser_client_id) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.browser_client_id ?? "-"}
          </dd>
          <dt>Device Endpoint</dt>
          <dd className={isChanged((config) => config.service_auth.login_info.device_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.device_endpoint ?? "-"}
          </dd>
          <dt>Browser Endpoint</dt>
          <dd className={isChanged((config) => config.service_auth.login_info.browser_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.browser_endpoint ?? "-"}
          </dd>
          <dt>Token Endpoint</dt>
          <dd className={isChanged((config) => config.service_auth.login_info.token_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.token_endpoint ?? "-"}
          </dd>
          <dt>Logout Endpoint</dt>
          <dd className={isChanged((config) => config.service_auth.login_info.logout_endpoint) ? highlightClass : ""}>
            {serviceConfig.service_auth.login_info.logout_endpoint ?? "-"}
          </dd>
        </dl>
      </section>
      <section
        aria-labelledby="cli-config-title"
        className="data-section"
      >
        <h3 id="cli-config-title">CLI Config</h3>
        <dl aria-labelledby="cli-config-title">
          <dt>Latest Version</dt>
          <dd className={isChanged((config) => config.cli_config.latest_version) ? highlightClass : ""}>
            {serviceConfig.cli_config.latest_version ?? "-"}
          </dd>
          <dt>Min Supported Version</dt>
          <dd className={isChanged((config) => config.cli_config.min_supported_version) ? highlightClass : ""}>
            {serviceConfig.cli_config.min_supported_version ?? "-"}
          </dd>
        </dl>
      </section>
      <section
        aria-labelledby="keys-title"
        className="data-section md:col-span-2"
      >
        <h3 id="keys-title">Keys</h3>
        <dl
          aria-labelledby="keys-title"
          className={isChanged((config) => config.service_auth.keys) ? highlightClass : ""}
        >
          {Object.entries(serviceConfig.service_auth.keys).map(([key, value]) => {
            return (
              <Fragment key={key}>
                <dt>Key</dt>
                <dd className="flex flex-row gap-global items-center">
                  {key}
                  {key === serviceConfig.service_auth.active_key ? (
                    <Tag
                      className="inline-block"
                      color={Colors.tag}
                    >
                      Active
                    </Tag>
                  ) : undefined}
                </dd>
                <dt>Public Key</dt>
                <dd>
                  <textarea
                    className="break-all w-full h-40"
                    readOnly
                    value={JSON.stringify(JSON.parse(value.public_key), null, 2)}
                    rows={10}
                  />
                </dd>
                <dt>Private Key</dt>
                <dd>{value.private_key}</dd>
              </Fragment>
            );
          })}
        </dl>
      </section>
    </div>
  );
};
