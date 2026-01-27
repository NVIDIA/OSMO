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
import Link from "next/link";

import { useAuth } from "~/components/AuthProvider";
import { Switch } from "~/components/Switch";
import { Colors, Tag } from "~/components/Tag";
import { type ProfileResponse } from "~/models";

interface ProfileSettingsProps {
  profile: ProfileResponse;
}

const ProfileSettings = ({ profile }: ProfileSettingsProps) => {
  const auth = useAuth();

  return (
    <dl>
      <dt>Name</dt>
      <dd>{auth.claims?.name}</dd>
      <dt>Email</dt>
      <dd>{profile.profile.username}</dd>
      <dt>Email Notifications</dt>
      <dd>
        <Switch
          checked={profile.profile.email_notification}
          disabled
          size="small"
          title={
            profile.profile.email_notification ? "Email notifications are enabled" : "Email notifications are disabled"
          }
        />
      </dd>

      <dt>Slack Notifications</dt>
      <dd>
        <Switch
          checked={profile.profile.slack_notification}
          disabled
          size="small"
          title={
            profile.profile.slack_notification ? "Slack notifications are enabled" : "Slack notifications are disabled"
          }
        />
      </dd>

      <dt>Default Bucket</dt>
      <dd>
        {profile.profile.bucket ? (
          <Tag
            color={Colors.platform}
            className="inline-block"
          >
            {profile.profile.bucket}
          </Tag>
        ) : (
          "None"
        )}
      </dd>

      <dt>Default Pool</dt>
      <dd>
        {profile.profile.pool ? (
          <Link
            href={`/pools/${profile.profile.pool}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open pool ${profile.profile.pool} in new tab`}
            className="tag-container"
          >
            <Tag color={Colors.pool}>{profile.profile.pool}</Tag>
          </Link>
        ) : (
          "None"
        )}
      </dd>

      <dt>Available Pools</dt>
      <dd>
        <ul>
          {profile.pools.map((pool) => (
            <li
              key={pool}
              className="mt-0 mb-1"
            >
              <Link
                href={`/pools/${pool}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open pool ${pool} in new tab`}
                className="tag-container"
              >
                <Tag color={Colors.pool}>{pool}</Tag>
              </Link>
            </li>
          ))}
        </ul>
      </dd>
    </dl>
  );
};

export default ProfileSettings;
