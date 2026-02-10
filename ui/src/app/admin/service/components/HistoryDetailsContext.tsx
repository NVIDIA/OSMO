//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import { createContext, type PropsWithChildren, useContext } from "react";

import { type ServiceConfigHistoryItem } from "~/models/config/service-config";

interface HistoryDetailsContextValue {
  configs: ServiceConfigHistoryItem[];
}

const HistoryDetailsContext = createContext<HistoryDetailsContextValue | null>(null);

export const HistoryDetailsProvider = ({ configs, children }: PropsWithChildren<HistoryDetailsContextValue>) => (
  <HistoryDetailsContext.Provider value={{ configs }}>{children}</HistoryDetailsContext.Provider>
);

export const useHistoryDetails = (): HistoryDetailsContextValue => {
  const context = useContext(HistoryDetailsContext);
  if (!context) {
    throw new Error("useHistoryDetails must be used within HistoryDetailsProvider");
  }
  return context;
};
