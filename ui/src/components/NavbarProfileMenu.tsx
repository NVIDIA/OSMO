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

import { useState } from "react";

import Link from "next/link";

import { useAuth } from "~/components/AuthProvider";
import useSafeTimeout from "~/hooks/useSafeTimeout";
import { useRuntimeEnv } from "~/runtime-env";
import { api } from "~/trpc/react";

import { FilledIcon, OutlinedIcon } from "./Icon";
import { IconButton } from "./IconButton";
import { InlineBanner } from "./InlineBanner";
import { SlideOut } from "./SlideOut";
import { TextInput } from "./TextInput";

export const NavbarProfileMenu = ({
  onItemClick,
  userName,
  initials,
}: {
  onItemClick: () => void;
  userName: string;
  initials: string;
}) => {
  const auth = useAuth();
  const runtimeEnv = useRuntimeEnv();
  const [openCLI, setOpenCLI] = useState(false);
  const [copied, setCopied] = useState(false);
  const cliCurl = `curl -fsSL ${runtimeEnv.CLI_INSTALL_SCRIPT_URL} | bash`;
  const version = api.version.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const { setSafeTimeout } = useSafeTimeout();
  return (
    <div role="complementary">
      <div className="flex lg:hidden flex-row body-header shadow-sm p-1 items-center">
        <span className="rounded-full bg-blue-800 text-white p-1">{initials}</span>
        <p className="p-global font-semibold whitespace-nowrap">{userName}</p>
      </div>
      <ul
        className="flex flex-col list-none py-global"
        aria-label="Profile Menu"
      >
        <li className="m-0 px-global list-none">
          <a
            target="_blank"
            rel="noopener noreferrer"
            href={runtimeEnv.DOCS_BASE_URL}
            className="btn btn-link no-underline w-full"
          >
            <FilledIcon name="menu_book" />
            Documentation
          </a>
        </li>
        <li className="m-0 px-global list-none">
          <IconButton
            alwaysShowText
            icon="download"
            text="Download CLI"
            className="btn btn-link no-underline w-full"
            onClick={() => {
              setOpenCLI(!openCLI);
            }}
            aria-expanded={openCLI}
            aria-haspopup="true"
            aria-controls="cli"
          />
        </li>
        <li className="m-0 px-global list-none">
          <Link
            href={`/workflows/submit`}
            className="btn btn-link no-underline w-full"
            onClick={onItemClick}
          >
            <OutlinedIcon name="send" />
            Submit Workflow
          </Link>
        </li>
        {auth.claims && (
          <>
            <li className="m-0 px-global mt-global pt-global list-none border-t border-border">
              <Link
                href="/profile"
                className="btn btn-link no-underline w-full"
                onClick={onItemClick}
              >
                <OutlinedIcon name="manage_accounts" />
                Settings
              </Link>
            </li>
            <li className="m-0 px-global list-none">
              <button
                className="btn btn-link no-underline w-full"
                onClick={(e) => {
                  e.preventDefault();
                  void auth.logout();
                  onItemClick();
                }}
              >
                <OutlinedIcon name="logout" />
                Sign Out
              </button>
            </li>
          </>
        )}
      </ul>
      {version.data && <p className="body-footer p-1 text-center sticky bottom-0 border-none">{version.data}</p>}
      <SlideOut
        id="cli"
        open={openCLI}
        onClose={() => setOpenCLI(false)}
        className="fixed top-0 right-2 mt-32 rounded-xl w-fit max-w-[90%]"
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
