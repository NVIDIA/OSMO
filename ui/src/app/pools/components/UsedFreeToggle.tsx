//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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
import { SHOW_USED_KEY } from "~/components/StoreProvider";
import { ViewToggleButton } from "~/components/ViewToggleButton";

export const UsedFreeToggle = ({
  isShowingUsed,
  updateUrl,
}: {
  isShowingUsed: boolean;
  updateUrl: (url: { isShowingUsed: boolean }) => void;
}) => {
  return (
    <fieldset
      className="toggle-group"
      aria-label="View Type"
    >
      <ViewToggleButton
        name="isShowingUsed"
        checked={isShowingUsed}
        onChange={() => {
          updateUrl({ isShowingUsed: true });
          localStorage.setItem(SHOW_USED_KEY, "true");
        }}
      >
        Used
      </ViewToggleButton>
      <ViewToggleButton
        name="isShowingUsed"
        checked={!isShowingUsed}
        onChange={() => {
          updateUrl({ isShowingUsed: false });
          localStorage.setItem(SHOW_USED_KEY, "false");
        }}
      >
        Free
      </ViewToggleButton>
    </fieldset>
  );
};
