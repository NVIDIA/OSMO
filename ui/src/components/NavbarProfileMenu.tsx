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
import { api } from "~/trpc/react";

import { FilledIcon, OutlinedIcon } from "./Icon";
import { InlineBanner } from "./InlineBanner";
import { SlideOut } from "./SlideOut";
import { TextInput } from "./TextInput";
import { TopMenu } from "./TopMenu";

export const NavbarProfileMenu = ({ onItemClick }: { onItemClick: () => void }) => {
  const auth = useAuth();
  const [openCLI, setOpenCLI] = useState(false);
  const [copied, setCopied] = useState(false);
  const cliCurl = `curl -fsSL ${typeof window !== "undefined" ? window.location.origin : ""}/client/install.sh | bash`;
  const version = api.version.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const { setSafeTimeout } = useSafeTimeout();

  return (
    <>
      <div className="flex flex-col justify-between h-full">
        <div>
          <TopMenu
            className="flex-col items-start border-b border-border p-3 md:hidden"
            onItemClick={onItemClick}
          />
          <div className="p-3 border-b border-border">
            <a
              target="_blank"
              rel="noopener noreferrer"
              href={`/docs/`}
              className="btn btn-link no-underline w-full"
            >
              <FilledIcon name="menu_book" />
              Documentation
            </a>
            <button
              className="btn btn-link no-underline w-full"
              onClick={() => {
                setOpenCLI(!openCLI);
              }}
            >
              <FilledIcon name="download" />
              Download CLI
            </button>
            <Link
              href={`/workflows/submit`}
              className="btn btn-link no-underline w-full"
              onClick={onItemClick}
            >
              <OutlinedIcon name="send" />
              Submit Workflow
            </Link>
          </div>
          {auth.claims && (
            <div className="p-3">
              <Link
                href="/profile"
                className="btn btn-link no-underline w-full"
                onClick={onItemClick}
              >
                <OutlinedIcon name="manage_accounts" />
                Settings
              </Link>
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
            </div>
          )}
        </div>
        {version.data && <p className="body-footer p-1 text-center sticky bottom-0">{version.data}</p>}
      </div>
      <SlideOut
        id="cli"
        open={openCLI}
        onClose={() => setOpenCLI(false)}
        className="fixed top-0 right-2 mt-32 rounded-xl w-[98%] max-w-150"
      >
        <div className="flex flex-col gap-3 p-3">
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <TextInput
                id="cli-curl"
                value={cliCurl}
                readOnly
                className="w-full"
                label="Use the following command to download the CLI"
              />
              <button
                type="button"
                className="btn btn-secondary mt-4"
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
          {copied && <InlineBanner status="success">Copied</InlineBanner>}
        </div>
      </SlideOut>
    </>
  );
};
