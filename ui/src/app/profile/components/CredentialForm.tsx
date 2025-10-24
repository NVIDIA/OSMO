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
import React, { useState } from "react";

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Select } from "~/components/Select";
import { Spinner } from "~/components/Spinner";
import { TextInput } from "~/components/TextInput";
import { env } from "~/env.mjs";
import {
  type BaseSetCredentialRequest,
  CredentialTypes,
  OSMOErrorResponseSchema,
  type SetCredentialRequest,
  SetCredentialsResponseSchema,
  type CredentialListItem,
} from "~/models";
import { useRuntimeEnv } from "~/runtime-env";
import { api } from "~/trpc/react";

import useToolParamUpdater from "../hooks/useToolParamUpdater";

const CredentialForm = ({
  currentCredentials,
  onUpdate,
}: {
  currentCredentials: CredentialListItem[];
  onUpdate: () => void;
}) => {
  const runtimeEnv = useRuntimeEnv();
  const toolParamUpdater = useToolParamUpdater();
  const mutation = api.credentials.setCredential.useMutation();
  const [credentialType, setCredentialType] = useState<CredentialTypes>(CredentialTypes.Registry);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [region, setRegion] = useState("");
  const [registry, setRegistry] = useState("");
  const [username, setUsername] = useState("");
  const [registryAuth, setRegistryAuth] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleCreateCredential = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(undefined);
    setShowSuccess(false);

    const credNames = currentCredentials.map((credential) => credential.cred_name);
    if (credNames.includes(name)) {
      setError(`Credential name ${name} already exists`);
      return;
    }

    const getRequestBody = (): SetCredentialRequest => {
      const baseRequest: BaseSetCredentialRequest = {
        cred_name: name,
      };

      switch (credentialType) {
        case CredentialTypes.Data:
          return {
            ...baseRequest,
            type: CredentialTypes.Data,
            data_credential: {
              endpoint: endpoint,
              access_key_id: accessKeyId,
              access_key: accessKey,
              region: region,
            },
          };
        case CredentialTypes.Generic:
          let parsedJSON: Record<string, string> = {};
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            parsedJSON = JSON.parse(credential ?? "{}");
            return {
              ...baseRequest,
              type: CredentialTypes.Generic,
              generic_credential: {
                credential: parsedJSON,
              },
            };
          } catch (e) {
            throw new Error(`Invalid JSON object \n${e as string}`);
          }
        case CredentialTypes.Registry:
        default:
          return {
            ...baseRequest,
            type: CredentialTypes.Registry,
            registry_credential: {
              registry: registry,
              username: username,
              auth: registryAuth,
            },
          };
      }
    };

    try {
      await mutation.mutateAsync(getRequestBody(), {
        onSuccess: (response) => {
          const result = SetCredentialsResponseSchema.safeParse(response);
          if (result.success) {
            setShowSuccess(true);
            onUpdate();
          } else {
            const parsedResponse = OSMOErrorResponseSchema.safeParse(response);
            setError(parsedResponse.data?.message ?? "Unknown error");
          }
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  const renderFormFields = () => {
    switch (credentialType) {
      case CredentialTypes.Data:
        return (
          <>
            <div className="flex flex-col">
              <p>Data storage solutions supported:</p>
              <ul className="ml-4">
                <li>
                  <a
                    className="link-inline"
                    href="https://aws.amazon.com/s3"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    AWS S3
                  </a>
                </li>
                <li>
                  <a
                    className="link-inline"
                    href="https://cloud.google.com/storage/docs/buckets"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GCP Google Storage
                  </a>
                </li>
              </ul>
            </div>
            <TextInput
              id="endpoint"
              containerClassName="w-full"
              className="w-full"
              label="Endpoint"
              placeholder="s3://bucket-name"
              name="endpoint"
              required={true}
              value={endpoint ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setEndpoint(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
            />
            <TextInput
              id="access_key_id"
              required={true}
              containerClassName="w-full"
              className="w-full"
              label="Access Key ID"
              name="access_key_id"
              value={accessKeyId ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setAccessKeyId(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
              placeholder="access-key-id"
              helperText="Your S3 ACL Access User"
            />
            <TextInput
              id="access_key"
              containerClassName="w-full"
              className="w-full"
              required={true}
              name="access_key"
              value={accessKey ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setAccessKey(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
              type="password"
              label="Access Key"
              helperText="Your S3 Secret Key"
            />
            <TextInput
              id="region"
              containerClassName="w-full"
              className="w-full"
              required={true}
              label="Region"
              name="region"
              value={region ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setRegion(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
              placeholder="us-east-1"
            />
          </>
        );
      case CredentialTypes.Registry:
        return (
          <>
            <p>
              <strong>{env.NEXT_PUBLIC_APP_NAME}</strong> lets you run containers from multiple registries. Visit our
              <a
                className="link-inline"
                href={`${runtimeEnv.DOCS_BASE_URL}getting_started/credentials/registry.html#registry`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {" "}
                docs
              </a>{" "}
              to see available registries.
            </p>
            <TextInput
              id="registry"
              containerClassName="w-full"
              className="w-full"
              required={true}
              name="registry"
              value={registry ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setRegistry(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
              placeholder="nvcr.io"
              label="Registry"
            />
            <TextInput
              id="username"
              containerClassName="w-full"
              className="w-full"
              required={true}
              label="Username"
              name="username"
              value={username ?? "$oauthtoken"}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setUsername(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
              helperText="Your Username. Use $oauthtoken for NGC"
              placeholder="$oauthtoken"
            />
            <p>
              To set up a registry through NGC,{" "}
              <a
                className="link-inline"
                href="https://ngc.nvidia.com/setup/api-key"
                target="_blank"
                rel="noopener noreferrer"
              >
                generate an API key
              </a>
            </p>
            <TextInput
              id="registry_auth"
              containerClassName="w-full"
              className="w-full"
              required={true}
              label="Authentication"
              name="registry_auth"
              type="password"
              value={registryAuth ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setRegistryAuth(e.target.value);
                setError(undefined);
                setShowSuccess(false);
              }}
              placeholder="Your API Key"
              helperText=""
            />
          </>
        );
      case CredentialTypes.Generic:
        return (
          <>
            <p>
              Any other secrets unrelated to registry and data can be stored as generic credentials. Enter your
              credential properties in JSON-like text.
            </p>
            <label className="flex flex-col w-full gap-1">
              <span>
                Credential <span className="text-red-600">*</span>
              </span>
              <textarea
                id="credential"
                required={true}
                className="font-mono w-full h-40 border-1 border-border p-3"
                name="credential"
                value={credential}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  setCredential(e.target.value);
                  setError(undefined);
                  setShowSuccess(false);
                }}
                placeholder={`{"additionalProp1": "string",\n"additionalProp2": "string"}`}
              />
            </label>
          </>
        );
      default:
        return null;
    }
  };
  return (
    <form onSubmit={handleCreateCredential}>
      <div className="flex flex-col w-120">
        <div className="flex flex-row gap-3 p-3 w-full">
          <Select
            id="credential_type"
            label="Credential Type"
            value={credentialType}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setCredentialType(e.target.value as CredentialTypes);
              setError(undefined);
              setShowSuccess(false);
            }}
            slotLeft={<OutlinedIcon name="manage_accounts" />}
          >
            <option value={CredentialTypes.Registry}>Registry</option>
            <option value={CredentialTypes.Data}>Data</option>
            <option value={CredentialTypes.Generic}>Generic</option>
          </Select>
          <TextInput
            id="cred_name"
            containerClassName="w-full"
            className="w-full"
            required={true}
            label="Credential Name"
            name="cred_name"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setName(e.target.value);
              setError(undefined);
              setShowSuccess(false);
            }}
          />
        </div>
        <div className="p-3 flex flex-col gap-3 w-full">{renderFormFields()}</div>
        <InlineBanner
          status={error ? "error" : showSuccess ? "success" : "none"}
          className="w-full"
        >
          {error ? (
            <div className="whitespace-pre-wrap">{error}</div>
          ) : showSuccess ? (
            "Credential created successfully"
          ) : (
            ""
          )}
        </InlineBanner>
        <div className="modal-footer p-3">
          {!showSuccess && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                toolParamUpdater({ tool: null });
              }}
              type="button"
            >
              Cancel
            </button>
          )}
          <button
            className="btn btn-primary h-8"
            type={showSuccess ? "button" : "submit"}
            onClick={() => {
              if (showSuccess) {
                toolParamUpdater({ tool: null });
              }
            }}
          >
            {mutation.isLoading ? (
              <Spinner
                className="border-black"
                size="button"
              />
            ) : !showSuccess ? (
              <OutlinedIcon name="save" />
            ) : null}
            {showSuccess ? "Close" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
};

export default CredentialForm;
