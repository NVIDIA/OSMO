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
import { usePathname, useRouter } from "next/navigation";

export enum ToolType {
  Settings = "settings",
  DeleteCredential = "delete-credential",
  CreateCredential = "create-credential",
}

export const PARAM_KEYS = {
  tool: "tool",
  credential: "credential",
} as const;

interface ToolParamUpdaterProps {
  tool?: ToolType | null;
  credential?: string | null;
}

// Undefined means no change; null means clear
const useToolParamUpdater = () => {
  const pathname = usePathname();
  const router = useRouter();

  const updateUrl = (props: ToolParamUpdaterProps): void => {
    const { tool, credential } = props;
    const newParams = new URLSearchParams(window.location.search);

    if (pathname !== window.location.pathname) {
      console.info("URL switched... ignoring update");
      return;
    }

    if (tool) {
      newParams.set(PARAM_KEYS.tool, tool);
    } else if (tool === null) {
      newParams.delete(PARAM_KEYS.tool);
    }

    if (credential) {
      newParams.set(PARAM_KEYS.credential, credential);
    } else if (credential === null) {
      newParams.delete(PARAM_KEYS.credential);
    }

    router.replace(`${pathname}?${newParams.toString()}`);
  };

  return updateUrl;
};

export default useToolParamUpdater;
