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

import { useEffect, useMemo, useRef, useState } from "react";

import { useSearchParams } from "next/navigation";

import FullPageModal from "~/components/FullPageModal";
import { OutlinedIcon } from "~/components/Icon";
import { PageError } from "~/components/PageError";
import { Spinner } from "~/components/Spinner";
import { TextInput } from "~/components/TextInput";
import { type CredentialListItem, type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";
import { checkExhaustive } from "~/utils/common";

import CredentialForm from "./components/CredentialForm";
import CredentialsTable from "./components/CredentialsTable";
import { DeleteCredential } from "./components/DeleteCredential";
import ProfileEditor from "./components/ProfileEditor";
import ProfileSettings from "./components/ProfileSettings";
import useToolParamUpdater, { PARAM_KEYS, ToolType } from "./hooks/useToolParamUpdater";

export default function ProfileSettingsPage() {
  const toolParamUpdater = useToolParamUpdater();
  const params = useSearchParams();
  const [tool, setTool] = useState<ToolType | undefined>(undefined);
  const [credential, setCredential] = useState<string | undefined>(undefined);
  const [credNameFilter, setCredNameFilter] = useState("");
  const headerRef = useRef<HTMLDivElement>(null);
  const profile = api.profile.getSettings.useQuery<ProfileResponse>(undefined, {
    refetchOnWindowFocus: false,
  });

  const credentials = api.credentials.getCredentials.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const tool = params.get(PARAM_KEYS.tool);
    setTool(tool ? (tool as ToolType) : undefined);

    // TODO: Refresh the credentials table if tool was delete_credential

    setCredential(params.get(PARAM_KEYS.credential) ?? undefined);
  }, [params]);

  const processCredentials = useMemo((): CredentialListItem[] => {
    // Can't pass workflows?.data ?? [] to useReactTable or it causes infinite loops and hangs the page
    // See https://github.com/TanStack/table/issues/4566
    // Momoizing it so that it does not get a new instance of [] every time fixes it
    if (!credentials.isSuccess) {
      return [];
    }

    return credentials.data;
  }, [credentials.data, credentials.isSuccess]);

  const toolHeading = useMemo(() => {
    if (!tool) {
      return "";
    }

    switch (tool) {
      case ToolType.Settings:
        return "Edit Profile";
      case ToolType.DeleteCredential:
        return "Delete Credential";
      case ToolType.CreateCredential:
        return "Create Credential";
      default:
        checkExhaustive(tool);
        return "";
    }
  }, [tool]);

  if (profile.error ?? credentials.error) {
    return (
      <PageError
        title="Error loading profile"
        errorMessage={profile.error?.message ?? credentials.error?.message}
      />
    );
  }

  if (profile.isLoading || credentials.isLoading || !profile.data || !credentials.data) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <div className={`grid h-full w-full gap-3 p-3 grid-cols-[1fr_3fr]`}>
        <div className="flex flex-col body-component">
          <div className={`popup-header brand-header`}>
            <h2>Profile</h2>
            <button
              className="btn btn-secondary"
              aria-label="Edit Profile"
              onClick={() => {
                toolParamUpdater({ tool: ToolType.Settings });
              }}
            >
              <OutlinedIcon name="edit" />
              Edit
            </button>
          </div>
          <div className="dag-details-body p-3">
            <ProfileSettings profile={profile.data} />
          </div>
        </div>
        <div className="flex flex-col body-component">
          <div
            className={`popup-header brand-header`}
            ref={headerRef}
          >
            <h2>Credentials</h2>
            <div className="flex flex-row gap-3">
              <TextInput
                id="credential-name"
                type="search"
                aria-label="Credential Name"
                placeholder="Filter by credential name..."
                value={credNameFilter}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setCredNameFilter(event.target.value);
                }}
                slotLeft={<OutlinedIcon name="search" />}
                className="w-60 bg-white"
              />
              <button
                className="btn btn-secondary"
                onClick={() => {
                  toolParamUpdater({ tool: ToolType.CreateCredential });
                }}
              >
                <OutlinedIcon name="add" />
                Add New Credential
              </button>
            </div>
          </div>
          <CredentialsTable
            credentials={processCredentials}
            nameFilter={credNameFilter}
          />
        </div>
      </div>
      <FullPageModal
        headerChildren={<h2>{toolHeading}</h2>}
        size="none"
        open={!!tool}
        onClose={() => {
          toolParamUpdater({ tool: null });
        }}
      >
        {tool === ToolType.Settings ? (
          <ProfileEditor
            profile={profile.data}
            onUpdate={() => {
              void profile.refetch();
            }}
          />
        ) : tool === ToolType.DeleteCredential && credential ? (
          <DeleteCredential
            credential={credential}
            onUpdate={() => {
              void credentials.refetch();
            }}
          />
        ) : tool === ToolType.CreateCredential ? (
          <CredentialForm
            currentCredentials={processCredentials}
            onUpdate={() => {
              void credentials.refetch();
            }}
          />
        ) : null}
      </FullPageModal>
    </>
  );
}
