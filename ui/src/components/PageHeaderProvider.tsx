//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

import { createContext, useContext, useMemo, useState } from "react";

type PageHeaderContextValue = {
  headerNode: React.ReactNode | null;
  setHeaderNode: (node: React.ReactNode | null) => void;
  title?: string;
  setTitle: (title?: string) => void;
};

const PageHeaderContext = createContext<PageHeaderContextValue | undefined>(undefined);

export const PageHeaderProvider = ({ children }: { children: React.ReactNode }) => {
  const [headerNode, setHeaderNode] = useState<React.ReactNode | null>(null);
  const [title, setTitle] = useState<string | undefined>(undefined);

  const value = useMemo(
    () => ({
      headerNode,
      setHeaderNode,
      title,
      setTitle,
    }),
    [headerNode, title],
  );

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
};

export const usePageHeaderContext = () => {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error("usePageHeaderContext must be used within a PageHeaderProvider");
  }
  return ctx;
};

export const HeaderOutlet = () => {
  const { headerNode } = usePageHeaderContext();

  return headerNode;
};

export const TitleOutlet = () => {
  const { title } = usePageHeaderContext();

  return title;
};
