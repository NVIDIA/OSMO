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

import { createContext, useContext, type ReactNode } from "react";

export interface RuntimeEnv {
  DOCS_BASE_URL: string;
  CLI_INSTALL_SCRIPT_URL: string;
}

const RuntimeEnvContext = createContext<RuntimeEnv | null>(null);

// Client component wrapper for the provider
export function RuntimeEnvProvider({
  children,
  value: envValue
}: {
  children: ReactNode;
  value: RuntimeEnv;
}) {
  return (
    <RuntimeEnvContext.Provider value={envValue}>
      {children}
    </RuntimeEnvContext.Provider>
  );
}

// Export a proper hook instead of property getters
export function useRuntimeEnv() {
  const ctx = useContext(RuntimeEnvContext);
  if (!ctx) throw new Error("RuntimeEnv not provided");
  return ctx;
}
