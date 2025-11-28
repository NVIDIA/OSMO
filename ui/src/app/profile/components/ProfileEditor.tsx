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

import { useEffect, useState } from "react";

import { useSearchParams } from "next/navigation";

import { OutlinedIcon } from "~/components/Icon";
import { InlineBanner } from "~/components/InlineBanner";
import { Select } from "~/components/Select";
import { Spinner } from "~/components/Spinner";
import { Switch } from "~/components/Switch";
import { OSMOErrorResponseSchema, ProfileChangeSettingsResponseSchema, type ProfileResponse } from "~/models";
import { api } from "~/trpc/react";

import useToolParamUpdater, { PARAM_KEYS, ToolType } from "../hooks/useToolParamUpdater";

const ProfileEditor = ({ profile, onUpdate }: { profile: ProfileResponse; onUpdate: () => void }) => {
  const toolParamUpdater = useToolParamUpdater();
  const mutation = api.profile.changeSettings.useMutation();
  const urlParams = useSearchParams();
  const [bucket, setBucket] = useState<string | undefined>(profile.profile.bucket ?? undefined);
  const [pool, setPool] = useState<string | undefined>(profile.profile.pool ?? undefined);
  const [slackNotification, setSlackNotification] = useState<boolean | undefined>(profile.profile.slack_notification);
  const [emailNotification, setEmailNotification] = useState<boolean | undefined>(profile.profile.email_notification);
  const [error, setError] = useState<string | undefined>(undefined);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);

  const { data: allBucketNames } = api.datasets.getBucketInfo.useQuery(
    {},
    {
      staleTime: Infinity,
      select: (data) => Object.keys(data ?? {}),
    },
  );

  useEffect(() => {
    const tool = urlParams.get(PARAM_KEYS.tool) as ToolType | null;
    if (!tool || tool !== ToolType.Settings) {
      setError(undefined);
      setShowSuccess(false);
    }
  }, [urlParams]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    setError(undefined);
    setShowSuccess(false);

    await mutation.mutateAsync(
      {
        bucket,
        pool,
        slack_notification: slackNotification,
        email_notification: emailNotification,
      },
      {
        onSuccess: (response) => {
          const parsedResponse = ProfileChangeSettingsResponseSchema.safeParse(response);
          if (parsedResponse.success) {
            setShowSuccess(true);
            onUpdate();
          } else {
            const errorResponse = OSMOErrorResponseSchema.safeParse(response);
            setError(errorResponse.error?.message ?? "Unknown error");
          }
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-col md:w-100">
        <div className="flex flex-col gap-global p-global w-full">
          <Select
            id="bucket"
            value={bucket ?? ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setBucket(e.target.value);
              setError(undefined);
              setShowSuccess(false);
            }}
            label="Bucket"
            slotLeft={<OutlinedIcon name="storage" />}
            helperText="Enter your default bucket"
            className="w-full"
          >
            <option value="">Select a bucket</option>
            {allBucketNames?.map((bucket) => (
              <option
                key={bucket}
                value={bucket}
              >
                {bucket}
              </option>
            ))}
          </Select>
          <Select
            id="pool"
            value={pool ?? ""}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              setPool(e.target.value);
              setError(undefined);
              setShowSuccess(false);
            }}
            label="Pool"
            slotLeft={<OutlinedIcon name="speaker_group" />}
            helperText="Enter your default pool"
            className="w-full"
          >
            <option value="">Select a pool</option>
            {profile.pools?.map((pool) => (
              <option
                key={pool}
                value={pool}
              >
                {pool}
              </option>
            ))}
          </Select>
          <fieldset
            aria-labelledby="notifications-label notifications-description"
            className="flex flex-col gap-1 mt-3"
          >
            <legend
              className="font-semibold text-sm"
              id="notifications-label"
            >
              Notification Preferences
            </legend>
            <div className="flex flex-row gap-10">
              <Switch
                id="slack-notification"
                checked={slackNotification ?? false}
                onChange={(checked: boolean) => {
                  setSlackNotification(checked);
                  setError(undefined);
                  setShowSuccess(false);
                }}
                label="Slack"
                className="w-full whitespace-nowrap"
                size="small"
                labelPosition="right"
              />
              <Switch
                id="email-notification"
                checked={emailNotification ?? false}
                onChange={(checked: boolean) => {
                  setEmailNotification(checked);
                  setError(undefined);
                  setShowSuccess(false);
                }}
                label="Email"
                className="w-full whitespace-nowrap"
                size="small"
                labelPosition="right"
              />
            </div>
            <p
              id="notifications-description"
              className="text-gray-700 text-xs"
            >
              Toggle to be notified of your workflows&apos; progress.
            </p>
          </fieldset>
        </div>
        <InlineBanner status={error ? "error" : showSuccess ? "success" : "none"}>
          {error ?? (showSuccess ? "Profile updated successfully" : <div />)}
        </InlineBanner>
        <div className="modal-footer">
          {!showSuccess && (
            <button
              className="btn h-8"
              type="button"
              onClick={() => {
                toolParamUpdater({ tool: null });
              }}
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

export default ProfileEditor;
