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

import Link from "next/link";
import { usePathname } from "next/navigation";

import { OutlinedIcon } from "~/components/Icon";
import { UrlTypes, useStore } from "~/components/StoreProvider";

export const getTopLevelLinks = (
  sidebarData: Map<UrlTypes, string>,
): { label: string; to: string; icon: React.ReactNode }[] => [
  { label: "Home", to: "/", icon: <OutlinedIcon name="home" /> },
  {
    label: "Pools",
    to: `/pools${sidebarData.get(UrlTypes.Pools) ?? ""}`,
    icon: <OutlinedIcon name="pool" />,
  },
  {
    label: "Resources",
    to: `/resources${sidebarData.get(UrlTypes.Resources) ?? ""}`,
    icon: <OutlinedIcon name="cloud" />,
  },
  {
    label: "Workflows",
    to: `/workflows${sidebarData.get(UrlTypes.Workflows) ?? ""}`,
    icon: <OutlinedIcon name="work_outline" />,
  },
  {
    label: "Tasks",
    to: `/tasks${sidebarData.get(UrlTypes.Tasks) ?? ""}`,
    icon: <OutlinedIcon name="task" />,
  },
  {
    label: "Datasets",
    to: `/datasets${sidebarData.get(UrlTypes.Datasets) ?? ""}`,
    icon: <OutlinedIcon name="dataset" />,
  },
];

export const TopMenu = ({
  className,
  showIcons = true,
  onItemClick,
}: {
  className?: string;
  showIcons?: boolean;
  onItemClick?: () => void;
}) => {
  const { sidebarData } = useStore();
  const links = getTopLevelLinks(sidebarData);
  const pathname = usePathname();
  const [activeLink, setActiveLink] = useState<number>(0);

  useEffect(() => {
    const route = pathname.split("/")[1];
    const index = links.findIndex((link) => {
      const linkRoute = link.to.split("?")[0];
      return linkRoute?.split("/")[1] === route;
    });

    setActiveLink(index ?? 0);
  }, [pathname, links]);

  return (
    <nav className={`flex ${className}`}>
      {links.map((link, index) => (
        <Link
          key={link.to}
          href={link.to}
          className={`btn btn-link no-underline text-base ${activeLink === index ? "font-bold" : ""}`}
          aria-current={activeLink === index}
          onClick={onItemClick}
        >
          {showIcons && link.icon}
          {link.label}
        </Link>
      ))}
    </nav>
  );
};
