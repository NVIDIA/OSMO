//SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

import { useEffect, useMemo, useState } from "react";

import { yupResolver } from "@hookform/resolvers/yup";
import { Controller, useForm } from "react-hook-form";
import * as yup from "yup";

import { InlineBanner } from "~/components/InlineBanner";
import { RoleEditor } from "~/components/RoleEditor";
import { TextInput } from "~/components/TextInput";
import { type ServiceConfig } from "~/models/config/service-config";

import { ServiceConfigOverview } from "./ServiceConfigOverview";

interface ServiceConfigEditorProps {
  serviceConfig: ServiceConfig;
  onSave: (description: string, tags: string[], config: ServiceConfig) => void;
  error?: string;
}

const agentQueueSizeSchema = yup
  .string()
  .required("Agent Queue Size is required")
  .test("is-int", "Agent Queue Size must be a whole number", (value) => Boolean(value && /^\d+$/.test(value)));

export const versionStringSchema = yup
  .string()
  .trim()
  .matches(/^\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/, "Version must be a valid version string");

export const durationStringSchema = yup
  .string()
  .trim()
  .matches(/^\d+(?:ms|us|[dhms])$/, "Duration must be like 1d, 2h, 30m, 15s, 500ms, or 250us");

export const serviceConfigSchema = yup.object({
  changeDescription: yup.string().trim().required("Change Description is required").defined(),
  tags: yup.array().of(yup.string().trim().defined()).default([]).defined(),
  service_base_url: yup
    .string()
    .trim()
    .url("Service Base URL must be a valid URL")
    .required("Service Base URL is required")
    .defined(),
  max_pod_restart_limit: durationStringSchema.required("Max Pod Restart Limit is required").defined(),
  agent_queue_size: agentQueueSizeSchema.defined(),
  max_token_duration: durationStringSchema.required("Max Token Duration is required").defined(),
  latest_version: versionStringSchema.required("CLI Latest Version is required").defined(),
  min_supported_version: versionStringSchema.required("CLI Min Supported Version is required").defined(),
  issuer: yup.string().trim().required("Issuer is required").defined(),
  audience: yup.string().trim().required("Audience is required").defined(),
  user_roles: yup
    .string()
    .trim()
    .required("User Roles is required")
    .test("roles-not-empty", "User Roles must include at least one role", (value) => {
      if (!value) {
        return false;
      }
      return (
        value
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean).length > 0
      );
    })
    .defined(),
  ctrl_roles: yup.string().trim().default("").defined(),
  device_client_id: yup.string().trim().required("Device Client ID is required").defined(),
  browser_client_id: yup.string().trim().required("Browser Client ID is required").defined(),
  device_endpoint: yup
    .string()
    .trim()
    .url("Device Endpoint must be a valid URL")
    .required("Device Endpoint is required")
    .defined(),
  browser_endpoint: yup
    .string()
    .trim()
    .url("Browser Endpoint must be a valid URL")
    .required("Browser Endpoint is required")
    .defined(),
  token_endpoint: yup
    .string()
    .trim()
    .url("Token Endpoint must be a valid URL")
    .required("Token Endpoint is required")
    .defined(),
  logout_endpoint: yup
    .string()
    .trim()
    .url("Logout Endpoint must be a valid URL")
    .required("Logout Endpoint is required")
    .defined(),
});

type ServiceConfigFormValues = yup.InferType<typeof serviceConfigSchema>;

export const ServiceConfigEditor = ({ serviceConfig, onSave, error }: ServiceConfigEditorProps) => {
  const [isComparing, setIsComparing] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<ServiceConfig>(serviceConfig);

  const defaultValues = useMemo<ServiceConfigFormValues>(
    () => ({
      changeDescription: "",
      tags: [],
      service_base_url: serviceConfig.service_base_url,
      max_pod_restart_limit: serviceConfig.max_pod_restart_limit,
      agent_queue_size: serviceConfig.agent_queue_size.toString(),
      max_token_duration: serviceConfig.service_auth.max_token_duration,
      latest_version: serviceConfig.cli_config.latest_version ?? "",
      min_supported_version: serviceConfig.cli_config.min_supported_version ?? "",
      issuer: serviceConfig.service_auth.issuer,
      audience: serviceConfig.service_auth.audience,
      user_roles: serviceConfig.service_auth.user_roles.join(", "),
      ctrl_roles: serviceConfig.service_auth.ctrl_roles.join(", "),
      device_client_id: serviceConfig.service_auth.login_info.device_client_id ?? "",
      browser_client_id: serviceConfig.service_auth.login_info.browser_client_id ?? "",
      device_endpoint: serviceConfig.service_auth.login_info.device_endpoint ?? "",
      browser_endpoint: serviceConfig.service_auth.login_info.browser_endpoint ?? "",
      token_endpoint: serviceConfig.service_auth.login_info.token_endpoint ?? "",
      logout_endpoint: serviceConfig.service_auth.login_info.logout_endpoint ?? "",
    }),
    [serviceConfig],
  );

  const {
    control,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors },
  } = useForm<ServiceConfigFormValues>({
    defaultValues,
    resolver: yupResolver(serviceConfigSchema),
  });

  useEffect(() => {
    reset(defaultValues);
    setCurrentConfig(serviceConfig);
    setIsComparing(false);
  }, [defaultValues, reset, serviceConfig]);

  const onSubmit = (values: ServiceConfigFormValues) => {
    if (isComparing) {
      onSave(values.changeDescription, values.tags, currentConfig);
      return;
    }

    setCurrentConfig({
      service_base_url: values.service_base_url,
      max_pod_restart_limit: values.max_pod_restart_limit,
      agent_queue_size: parseInt(values.agent_queue_size, 10),
      cli_config: {
        latest_version: values.latest_version,
        min_supported_version: values.min_supported_version,
      },
      service_auth: {
        ...serviceConfig.service_auth,
        issuer: values.issuer,
        audience: values.audience,
        user_roles: values.user_roles
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean),
        ctrl_roles: values.ctrl_roles
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean),
        max_token_duration: values.max_token_duration,
        login_info: {
          device_client_id: values.device_client_id,
          browser_client_id: values.browser_client_id,
          device_endpoint: values.device_endpoint,
          browser_endpoint: values.browser_endpoint,
          token_endpoint: values.token_endpoint,
          logout_endpoint: values.logout_endpoint,
        },
      },
    });
    setIsComparing(true);
  };

  const focusFirstError = () => {
    const focusOrder: (keyof ServiceConfigFormValues)[] = [
      "changeDescription",
      "max_pod_restart_limit",
      "agent_queue_size",
      "max_token_duration",
      "latest_version",
      "min_supported_version",
      "device_client_id",
      "browser_client_id",
      "issuer",
      "audience",
      "ctrl_roles",
      "service_base_url",
      "device_endpoint",
      "browser_endpoint",
      "token_endpoint",
      "logout_endpoint",
    ];

    const firstErrorField = focusOrder.find((field) => errors[field]);
    if (firstErrorField) {
      setFocus(firstErrorField);
    }
  };

  return (
    <form
      className="relative flex flex-col w-full h-full overflow-y-auto"
      onSubmit={handleSubmit(onSubmit, focusFirstError)}
    >
      <div className="grid grid-cols-[1fr_auto] gap-global p-global border-y border-border bg-headerbg">
        <Controller
          name="changeDescription"
          control={control}
          render={({ field }) => (
            <TextInput
              id="change_description"
              label="Change Description"
              value={field.value}
              onChange={field.onChange}
              ref={field.ref}
              required
              className="w-full"
              errorText={errors.changeDescription?.message}
            />
          )}
        />
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <RoleEditor
              label="Tags"
              entityLabel="Tag"
              roles={field.value}
              setRoles={field.onChange}
              message={errors.tags?.message ?? null}
              isError={Boolean(errors.tags)}
            />
          )}
        />
      </div>
      {isComparing ? (
        <div className="flex flex-row gap-global p-global h-full">
          <div className="flex flex-col gap-global card h-full">
            <h3 className="body-header p-global">Current Version</h3>
            <ServiceConfigOverview
              serviceConfig={currentConfig}
              previousConfig={serviceConfig}
              isShowingJSON={false}
            />
          </div>
          <div className="flex flex-col gap-global card h-full">
            <h3 className="body-header p-global">New Version</h3>
            <ServiceConfigOverview
              serviceConfig={serviceConfig}
              previousConfig={currentConfig}
              isShowingJSON={false}
            />
          </div>
        </div>
      ) : (
        <div className="config-editor">
          <div className="flex flex-col gap-global">
            <Controller
              name="max_pod_restart_limit"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="max_pod_restart_limit"
                  label="Max Pod Restart Limit"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  helperText="e.g., 15m, 1h, 30s"
                  errorText={errors.max_pod_restart_limit?.message}
                />
              )}
            />
            <Controller
              name="agent_queue_size"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="agent_queue_size"
                  label="Agent Queue Size"
                  type="number"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.agent_queue_size?.message}
                />
              )}
            />
            <Controller
              name="max_token_duration"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="max_token_duration"
                  label="Max Token Duration"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  helperText="e.g., 365d, 24h, 60m"
                  errorText={errors.max_token_duration?.message}
                />
              )}
            />
            <Controller
              name="latest_version"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="latest_version"
                  label="CLI Latest Version"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.latest_version?.message}
                />
              )}
            />
            <Controller
              name="min_supported_version"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="min_supported_version"
                  label="CLI Min Supported Version"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.min_supported_version?.message}
                />
              )}
            />
            <Controller
              name="device_client_id"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="device_client_id"
                  label="Device Client ID"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.device_client_id?.message}
                />
              )}
            />
            <Controller
              name="browser_client_id"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="browser_client_id"
                  label="Browser Client ID"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.browser_client_id?.message}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-global">
            <Controller
              name="issuer"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="issuer"
                  label="Issuer"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.issuer?.message}
                />
              )}
            />
            <Controller
              name="audience"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="audience"
                  label="Audience"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.audience?.message}
                />
              )}
            />
            <Controller
              name="user_roles"
              control={control}
              render={({ field }) => (
                <RoleEditor
                  label="User Roles"
                  entityLabel="Role"
                  roles={field.value
                    .split(",")
                    .map((role) => role.trim())
                    .filter(Boolean)}
                  setRoles={(roles) => field.onChange(roles.join(", "))}
                  message={errors.user_roles?.message ?? null}
                  isError={Boolean(errors.user_roles)}
                />
              )}
            />
            <Controller
              name="ctrl_roles"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="ctrl_roles"
                  label="Ctrl Roles"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  helperText="Comma-separated list of roles"
                  errorText={errors.ctrl_roles?.message}
                />
              )}
            />
          </div>
          <div className="flex flex-col gap-global md:col-span-2 lg:col-span-1">
            <Controller
              name="service_base_url"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="service_base_url"
                  label="Service Base URL"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.service_base_url?.message}
                />
              )}
            />
            <Controller
              name="device_endpoint"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="device_endpoint"
                  label="Device Endpoint"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.device_endpoint?.message}
                />
              )}
            />
            <Controller
              name="browser_endpoint"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="browser_endpoint"
                  label="Browser Endpoint"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.browser_endpoint?.message}
                />
              )}
            />
            <Controller
              name="token_endpoint"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="token_endpoint"
                  label="Token Endpoint"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.token_endpoint?.message}
                />
              )}
            />
            <Controller
              name="logout_endpoint"
              control={control}
              render={({ field }) => (
                <TextInput
                  id="logout_endpoint"
                  label="Logout Endpoint"
                  value={field.value}
                  onChange={field.onChange}
                  ref={field.ref}
                  required
                  errorText={errors.logout_endpoint?.message}
                />
              )}
            />
            <InlineBanner status={error ? "error" : "none"}>{error}</InlineBanner>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-global p-global border-t border-border bg-footerbg sticky bottom-0">
        {isComparing ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsComparing(false)}
          >
            Back
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              reset(defaultValues);
              setCurrentConfig(serviceConfig);
            }}
          >
            Reset
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary"
        >
          {isComparing ? "Save" : "Next"}
        </button>
      </div>
    </form>
  );
};
