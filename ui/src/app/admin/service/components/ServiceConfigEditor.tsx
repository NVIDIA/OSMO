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

import { useState } from "react";

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { RoleEditor } from "~/components/RoleEditor";
import { TextInput } from "~/components/TextInput";
import { type ServiceConfig } from "~/models/config/service-config";

interface ServiceConfigEditorProps {
  serviceConfig: ServiceConfig;
  onSave: (config: ServiceConfig) => void;
  onCancel: () => void;
  isSaving?: boolean;
  error?: string;
}

export const ServiceConfigEditor = ({
  serviceConfig,
  onSave,
  onCancel,
  isSaving = false,
  error,
}: ServiceConfigEditorProps) => {
  // General settings
  const [serviceBaseUrl, setServiceBaseUrl] = useState(serviceConfig.service_base_url);
  const [maxPodRestartLimit, setMaxPodRestartLimit] = useState(serviceConfig.max_pod_restart_limit);
  const [agentQueueSize, setAgentQueueSize] = useState(serviceConfig.agent_queue_size.toString());

  // CLI Config
  const [latestVersion, setLatestVersion] = useState(serviceConfig.cli_config.latest_version);
  const [minSupportedVersion, setMinSupportedVersion] = useState(serviceConfig.cli_config.min_supported_version);

  // Auth settings
  const [issuer, setIssuer] = useState(serviceConfig.service_auth.issuer);
  const [audience, setAudience] = useState(serviceConfig.service_auth.audience);
  const [userRoles, setUserRoles] = useState(serviceConfig.service_auth.user_roles.join(", "));
  const [ctrlRoles, setCtrlRoles] = useState(serviceConfig.service_auth.ctrl_roles.join(", "));
  const [maxTokenDuration, setMaxTokenDuration] = useState(serviceConfig.service_auth.max_token_duration);

  // Login Info
  const [deviceClientId, setDeviceClientId] = useState(serviceConfig.service_auth.login_info.device_client_id);
  const [browserClientId, setBrowserClientId] = useState(serviceConfig.service_auth.login_info.browser_client_id);
  const [deviceEndpoint, setDeviceEndpoint] = useState(serviceConfig.service_auth.login_info.device_endpoint);
  const [browserEndpoint, setBrowserEndpoint] = useState(serviceConfig.service_auth.login_info.browser_endpoint);
  const [tokenEndpoint, setTokenEndpoint] = useState(serviceConfig.service_auth.login_info.token_endpoint);
  const [logoutEndpoint, setLogoutEndpoint] = useState(serviceConfig.service_auth.login_info.logout_endpoint);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const updatedConfig: ServiceConfig = {
      service_base_url: serviceBaseUrl,
      max_pod_restart_limit: maxPodRestartLimit,
      agent_queue_size: parseInt(agentQueueSize, 10),
      cli_config: {
        latest_version: latestVersion,
        min_supported_version: minSupportedVersion,
      },
      service_auth: {
        ...serviceConfig.service_auth,
        issuer,
        audience,
        user_roles: userRoles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        ctrl_roles: ctrlRoles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
        max_token_duration: maxTokenDuration,
        login_info: {
          device_client_id: deviceClientId,
          browser_client_id: browserClientId,
          device_endpoint: deviceEndpoint,
          browser_endpoint: browserEndpoint,
          token_endpoint: tokenEndpoint,
          logout_endpoint: logoutEndpoint,
        },
      },
    };

    onSave(updatedConfig);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-global w-full h-full"
    >
      {error && <InlineBanner status="error">{error}</InlineBanner>}

      <div className="flex flex-row flex-wrap gap-global p-global w-full">
        <fieldset className="form-group">
          <legend>General Settings</legend>
          <TextInput
            id="service_base_url"
            label="Service Base URL"
            value={serviceBaseUrl}
            onChange={(e) => setServiceBaseUrl(e.target.value)}
            required
            className="min-w-150"
          />
          <TextInput
            id="max_pod_restart_limit"
            label="Max Pod Restart Limit"
            value={maxPodRestartLimit}
            onChange={(e) => setMaxPodRestartLimit(e.target.value)}
            required
            helperText="e.g., 15m, 1h, 30s"
          />
          <TextInput
            id="agent_queue_size"
            label="Agent Queue Size"
            type="number"
            value={agentQueueSize}
            onChange={(e) => setAgentQueueSize(e.target.value)}
            required
          />
        </fieldset>
        <fieldset className="form-group">
          <legend>CLI Config</legend>
          <TextInput
            id="latest_version"
            label="Latest Version"
            value={latestVersion ?? ""}
            onChange={(e) => setLatestVersion(e.target.value)}
            required
          />
          <TextInput
            id="min_supported_version"
            label="Min Supported Version"
            value={minSupportedVersion ?? ""}
            onChange={(e) => setMinSupportedVersion(e.target.value)}
            required
          />
        </fieldset>
        <fieldset className="form-group">
          <legend>Auth Settings</legend>
          <TextInput
            id="issuer"
            label="Issuer"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            required
          />
          <TextInput
            id="audience"
            label="Audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            required
          />
          <TextInput
            id="user_roles"
            label="User Roles"
            value={userRoles}
            onChange={(e) => setUserRoles(e.target.value)}
            helperText="Comma-separated list of roles"
          />
          <RoleEditor
            label="User Roles"
            roles={userRoles.split(",").map((r) => r.trim())}
            setRoles={(roles) => setUserRoles(roles.join(", "))}
            message={null}
            isError={false}
          />
          <TextInput
            id="ctrl_roles"
            label="Ctrl Roles"
            value={ctrlRoles}
            onChange={(e) => setCtrlRoles(e.target.value)}
            helperText="Comma-separated list of roles"
          />
          <TextInput
            id="max_token_duration"
            label="Max Token Duration"
            value={maxTokenDuration}
            onChange={(e) => setMaxTokenDuration(e.target.value)}
            required
            helperText="e.g., 365d, 24h, 60m"
          />
        </fieldset>
        <fieldset className="form-group">
          <legend>Login Info</legend>
          <TextInput
            id="device_client_id"
            label="Device Client ID"
            value={deviceClientId ?? ""}
            onChange={(e) => setDeviceClientId(e.target.value)}
            required
          />
          <TextInput
            id="browser_client_id"
            label="Browser Client ID"
            value={browserClientId ?? ""}
            onChange={(e) => setBrowserClientId(e.target.value)}
            required
          />
          <TextInput
            id="device_endpoint"
            label="Device Endpoint"
            value={deviceEndpoint ?? ""}
            onChange={(e) => setDeviceEndpoint(e.target.value)}
            required
            className="min-w-150"
          />
          <TextInput
            id="browser_endpoint"
            label="Browser Endpoint"
            value={browserEndpoint ?? ""}
            onChange={(e) => setBrowserEndpoint(e.target.value)}
            required
            className="min-w-150"
          />
          <TextInput
            id="token_endpoint"
            label="Token Endpoint"
            value={tokenEndpoint ?? ""}
            onChange={(e) => setTokenEndpoint(e.target.value)}
            required
            className="min-w-150"
          />
          <TextInput
            id="logout_endpoint"
            label="Logout Endpoint"
            value={logoutEndpoint ?? ""}
            onChange={(e) => setLogoutEndpoint(e.target.value)}
            required
            className="min-w-150"
          />
        </fieldset>
      </div>
      {/* Action Buttons */}
      <div className="flex justify-end gap-global p-global border-t border-gray-200">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isSaving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={isSaving}
        >
          {isSaving ? (
            <>
              <OutlinedIcon
                name="sync"
                className="animate-spin"
              />
              Saving...
            </>
          ) : (
            <>
              <OutlinedIcon name="save" />
              Save Changes
            </>
          )}
        </button>
      </div>
    </form>
  );
};
