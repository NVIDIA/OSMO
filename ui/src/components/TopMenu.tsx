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

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { FilledIcon, OutlinedIcon } from "~/components/Icon";
import { UrlTypes, useStore } from "~/components/StoreProvider";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { useRuntimeEnv } from "~/runtime-env";
import { api } from "~/trpc/react";

import { useAuth } from "./AuthProvider";
import { IconButton } from "./IconButton";
import { InlineBanner } from "./InlineBanner";
import { SlideOut } from "./SlideOut";
import { TextInput } from "./TextInput";

const MenuLink = ({
  label,
  to,
  icon,
  isActive,
  onItemClick,
}: {
  label: string;
  to: string;
  icon: React.ReactNode;
  isActive: boolean;
  onItemClick: () => void;
}) => {
  return (
    <li>
      <Link
        href={to}
        className={`btn btn-link no-underline m-0 p-0 ${isActive ? "font-bold" : ""}`}
        aria-current={isActive}
        onClick={onItemClick}
      >
        {icon}
        {label}
      </Link>
    </li>
  );
};

const MenuExternalLink = ({ label, href, icon }: { label: string; href: string; icon: React.ReactNode }) => {
  return (
    <li>
      <a
        target="_blank"
        rel="noopener noreferrer"
        href={href}
        className="btn btn-link no-underline m-0 p-0"
      >
        {icon}
        {label}
      </a>
    </li>
  );
};

const MenuSeparator = () => {
  return <li className="list-none border-b border-border pt-global mb-global" />;
};

export const TopMenu = ({ onItemClick }: { onItemClick: () => void }) => {
  const auth = useAuth();
  const runtimeEnv = useRuntimeEnv();
  const { sidebarData } = useStore();
  const pathname = usePathname();
  const [activeRoute, setActiveRoute] = useState<string | undefined>(undefined);
  const [openCLI, setOpenCLI] = useState(false);
  const [cliCanOpen, setCliCanOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const cliCurl = `curl -fsSL ${runtimeEnv.CLI_INSTALL_SCRIPT_URL} | bash`;
  const { setSafeTimeout } = useSafeTimeout();

  const version = api.version.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (openCLI) {
      setCliCanOpen(false);
    } else {
      setSafeTimeout(() => setCliCanOpen(true), 100);
    }
  }, [openCLI, setSafeTimeout]);

  const links = useMemo((): React.ReactNode[] => {
    const links: React.ReactNode[] = [
      <MenuLink
        key="pools"
        label="Pools"
        to={`/pools${sidebarData.get(UrlTypes.Pools) ?? ""}`}
        icon={<OutlinedIcon name="pool" />}
        isActive={activeRoute === "pools"}
        onItemClick={onItemClick}
      />,
      <MenuLink
        key="resources"
        label="Resources"
        to={`/resources${sidebarData.get(UrlTypes.Resources) ?? ""}`}
        icon={<OutlinedIcon name="cloud" />}
        isActive={activeRoute === "resources"}
        onItemClick={onItemClick}
      />,
      <MenuLink
        key="workflows"
        label="Workflows"
        to={`/workflows${sidebarData.get(UrlTypes.Workflows) ?? ""}`}
        icon={<OutlinedIcon name="work_outline" />}
        isActive={activeRoute === "workflows" && pathname !== "/workflows/submit"}
        onItemClick={onItemClick}
      />,
      <MenuLink
        key="tasks"
        label="Tasks"
        to={`/tasks${sidebarData.get(UrlTypes.Tasks) ?? ""}`}
        icon={<OutlinedIcon name="task" />}
        isActive={activeRoute === "tasks"}
        onItemClick={onItemClick}
      />,
      <MenuLink
        key="datasets"
        label="Datasets"
        to={`/datasets${sidebarData.get(UrlTypes.Datasets) ?? ""}`}
        icon={<OutlinedIcon name="dataset" />}
        isActive={activeRoute === "datasets"}
        onItemClick={onItemClick}
      />,
    ];

    if (auth.claims) {
      links.push(
        <MenuLink
          key="profile"
          label="Profile"
          to={`/profile`}
          icon={<OutlinedIcon name="person" />}
          isActive={activeRoute === "profile"}
          onItemClick={onItemClick}
        />,
      );
    }

    links.push(<MenuSeparator key="main-actions-separator" />);

    links.push(
      <MenuExternalLink
        key="docs"
        label="Documentation"
        href={runtimeEnv.DOCS_BASE_URL}
        icon={<FilledIcon name="menu_book" />}
      />,
    );

    links.push(
      <li key="download-cli">
        <IconButton
          alwaysShowText
          icon="download"
          text="Download CLI"
          className="btn btn-link no-underline m-0 p-0 w-full"
          onClick={() => {
            if (!openCLI && cliCanOpen) {
              setOpenCLI(true);
            }
          }}
          aria-expanded={openCLI}
          aria-haspopup="dialog"
          aria-controls="cli"
        />
      </li>,
    );

    links.push(
      <MenuLink
        key="submit-workflow"
        label="Submit Workflow"
        to={`/workflows/submit`}
        icon={<OutlinedIcon name="send" />}
        isActive={pathname === "/workflows/submit"}
        onItemClick={onItemClick}
      />,
    );

    if (auth.claims) {
      links.push(<MenuSeparator key="user-actions-separator" />);

      links.push(
        <li key="sign-out">
          <button
            className="btn btn-link no-underline m-0 p-0 w-full"
            onClick={(e) => {
              e.preventDefault();
              void auth.logout();
              onItemClick();
            }}
          >
            <OutlinedIcon name="logout" />
            Sign Out
          </button>
        </li>,
      );
    }

    return links;
  }, [sidebarData, activeRoute, onItemClick, auth, runtimeEnv, openCLI, setOpenCLI, pathname, cliCanOpen]);

  useEffect(() => {
    const route = pathname.split("/")[1];
    setActiveRoute(route ?? undefined);
  }, [pathname]);

  return (
    <div
      role="navigation"
      className="h-full flex flex-col justify-between gap-global bg-page-header-bg"
    >
      <ul
        className="top-menu"
        aria-label="Main menu"
      >
        {links}
      </ul>
      {version.data && <p className="border-y-1 border-border p-global text-center font-semibold">{version.data}</p>}
      <SlideOut
        id="cli"
        animate={false}
        open={openCLI}
        onClose={() => setOpenCLI(false)}
        className="fixed top-0 left-2 mt-32 rounded-xl w-fit max-w-[90vw]"
      >
        <div className="flex flex-col gap-global p-global">
          <form
            onSubmit={(e) => e.preventDefault()}
            className="mt-6"
          >
            <div className="grid grid-cols-[1fr_auto] gap-global">
              <TextInput
                id="cli-curl"
                value={cliCurl}
                readOnly
                size={cliCurl.length}
                label="Use the following command to download the CLI"
              />
              <button
                type="button"
                className="btn btn-secondary mt-5"
                onClick={async () => {
                  if (navigator.clipboard) {
                    await navigator.clipboard.writeText(cliCurl);
                    setCopied(true);
                    setSafeTimeout(() => setCopied(false), 2000);
                  }
                }}
                title="Copy to clipboard"
              >
                <OutlinedIcon name="content_copy" />
              </button>
            </div>
          </form>
          <InlineBanner status={copied ? "success" : "none"}>{copied ? "Copied" : ""}</InlineBanner>
        </div>
      </SlideOut>
    </div>
  );
};
