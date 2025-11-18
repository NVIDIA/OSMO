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

import { type PropsWithChildren, useEffect, useRef, useState } from "react";

import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { useMediaQuery } from "usehooks-ts";

import { env } from "~/env.mjs";
import { type AuthClaims } from "~/models/auth-model";
import { ZERO_WIDTH_SPACE } from "~/utils/string";

import { useAuth } from "./AuthProvider";
import { FilledIcon, OutlinedIcon } from "./Icon";
import { NavbarProfileMenu } from "./NavbarProfileMenu";
import { HeaderOutlet, PageHeaderProvider } from "./PageHeaderProvider";
import { SlideOut } from "./SlideOut";
import { TopMenu } from "./TopMenu";

const getUserDetails = (claims: AuthClaims | null) => {
  if (!claims) {
    return { initials: "NA", userName: "Guest" };
  }

  const { given_name, family_name, name } = claims;
  const first = (given_name ?? name ?? "").charAt(0).toUpperCase();
  const last = (family_name ?? name?.split(" ")[1] ?? "").charAt(0).toUpperCase();

  return {
    initials: `${first}${last}`,
    userName: `${name}`,
  };
};

export const Layout = ({ children }: PropsWithChildren) => {
  const auth = useAuth();
  const pathname = usePathname();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const { initials, userName } = getUserDetails(auth.claims);
  const headerRef = useRef<HTMLDivElement>(null);
  const showTopMenu = useMediaQuery("(min-width: 1024px)");
  const mainMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Only run in browser environment
    if (typeof document === "undefined") {
      return;
    }

    // Function to handle the event
    const onCopy = (event: ClipboardEvent) => {
      if (event.clipboardData && typeof window !== "undefined") {
        const text = window.getSelection()?.toString();
        if (text && text.includes(ZERO_WIDTH_SPACE)) {
          event.clipboardData.setData("text/plain", text.replaceAll(ZERO_WIDTH_SPACE, ""));
          event.preventDefault();
        }
      }
    };

    // Add the event listener to the document
    document.addEventListener("copy", onCopy);

    // Clean up the event listener when the component unmounts
    return () => {
      document.removeEventListener("copy", onCopy);
    };
  }, []);

  return (
    <ThemeProvider forcedTheme="light">
      <PageHeaderProvider>
        <div className="flex flex-col h-screen w-screen">
          <a
            href="#main-content"
            className="btn skip-to-content"
          >
            Skip to content
          </a>
          <header
            className="page-header py-1 px-1 md:px-2 bg-white lg:border-b-0 shadow-sm"
            ref={headerRef}
          >
            <div className="flex items-center gap-global lg:gap-8 grow min-w-0">
              <div className="flex items-center gap-global">
                <svg
                  enableBackground="new 0 0 974.7 179.7"
                  version="1.1"
                  viewBox="0 0 974.7 179.7"
                  xmlns="http://www.w3.org/2000/svg"
                  width="110"
                  height="44"
                  className="mt-[-2px]"
                >
                  <title>Artificial Intelligence Computing Leadership from NVIDIA</title>
                  <path d="m962.1 144.1v-2.7h1.7c0.9 0 2.2 0.1 2.2 1.2s-0.7 1.5-1.8 1.5h-2.1m0 1.9h1.2l2.7 4.7h2.9l-3-4.9c1.5 0.1 2.7-1 2.8-2.5v-0.4c0-2.6-1.8-3.4-4.8-3.4h-4.3v11.2h2.5v-4.7m12.6-0.9c0-6.6-5.1-10.4-10.8-10.4s-10.8 3.8-10.8 10.4 5.1 10.4 10.8 10.4 10.8-3.8 10.8-10.4m-3.2 0c0.2 4.2-3.1 7.8-7.3 8h-0.3c-4.4 0.2-8.1-3.3-8.3-7.7s3.3-8.1 7.7-8.3 8.1 3.3 8.3 7.7c-0.1 0.1-0.1 0.2-0.1 0.3z"></path>
                  <path d="m578.2 34v118h33.3v-118h-33.3zm-262-0.2v118.1h33.6v-91.7l26.2 0.1c8.6 0 14.6 2.1 18.7 6.5 5.3 5.6 7.4 14.7 7.4 31.2v53.9h32.6v-65.2c0-46.6-29.7-52.9-58.7-52.9h-59.8zm315.7 0.2v118h54c28.8 0 38.2-4.8 48.3-15.5 7.2-7.5 11.8-24.1 11.8-42.2 0-16.6-3.9-31.4-10.8-40.6-12.2-16.5-30-19.7-56.6-19.7h-46.7zm33 25.6h14.3c20.8 0 34.2 9.3 34.2 33.5s-13.4 33.6-34.2 33.6h-14.3v-67.1zm-134.7-25.6l-27.8 93.5-26.6-93.5h-36l38 118h48l38.4-118h-34zm231.4 118h33.3v-118h-33.3v118zm93.4-118l-46.5 117.9h32.8l7.4-20.9h55l7 20.8h35.7l-46.9-117.8h-44.5zm21.6 21.5l20.2 55.2h-41l20.8-55.2z"></path>
                  <path
                    fill="#76B900"
                    d="m101.3 53.6v-16.2c1.6-0.1 3.2-0.2 4.8-0.2 44.4-1.4 73.5 38.2 73.5 38.2s-31.4 43.6-65.1 43.6c-4.5 0-8.9-0.7-13.1-2.1v-49.2c17.3 2.1 20.8 9.7 31.1 27l23.1-19.4s-16.9-22.1-45.3-22.1c-3-0.1-6 0.1-9 0.4m0-53.6v24.2l4.8-0.3c61.7-2.1 102 50.6 102 50.6s-46.2 56.2-94.3 56.2c-4.2 0-8.3-0.4-12.4-1.1v15c3.4 0.4 6.9 0.7 10.3 0.7 44.8 0 77.2-22.9 108.6-49.9 5.2 4.2 26.5 14.3 30.9 18.7-29.8 25-99.3 45.1-138.7 45.1-3.8 0-7.4-0.2-11-0.6v21.1h170.2v-179.7h-170.4zm0 116.9v12.8c-41.4-7.4-52.9-50.5-52.9-50.5s19.9-22 52.9-25.6v14h-0.1c-17.3-2.1-30.9 14.1-30.9 14.1s7.7 27.3 31 35.2m-73.5-39.5s24.5-36.2 73.6-40v-13.2c-54.4 4.4-101.4 50.4-101.4 50.4s26.6 77 101.3 84v-14c-54.8-6.8-73.5-67.2-73.5-67.2z"
                  ></path>
                </svg>
                <p className="text-lg font-bold">{env.NEXT_PUBLIC_APP_NAME}</p>
              </div>
              {showTopMenu ? (
                <div role="navigation">
                  <ul
                    className="list-none p-0 m-0 flex items-center gap-1 lg:gap-global text-base"
                    aria-label="Main menu"
                  >
                    <TopMenu
                      showIcons={false}
                      className="m-0"
                    />
                  </ul>
                </div>
              ) : (
                <>
                  <button
                    className="btn btn-tertiary px-0 gap-0 relative capitalize text-xl font-bold"
                    aria-expanded={mainMenuOpen}
                    aria-haspopup="true"
                    aria-controls="main-menu"
                    onClick={() => {
                      setMainMenuOpen(!mainMenuOpen);
                    }}
                    ref={mainMenuButtonRef}
                  >
                    {pathname.split("/")[1]}
                    <OutlinedIcon
                      className="bg-transparent absolute text-3xl! bottom-[-1rem] right-[-0.6rem]"
                      name="arrow_drop_down"
                    />
                  </button>
                </>
              )}
              <HeaderOutlet />
            </div>
            <button
              className="btn btn-tertiary p-0"
              aria-expanded={profileMenuOpen}
              aria-haspopup="true"
              aria-controls="profile-menu"
              onClick={() => {
                if (!profileMenuOpen) {
                  setProfileMenuOpen(true);
                }
              }}
            >
              <FilledIcon
                name="account_circle"
                className="block! lg:hidden! text-blue-800"
              />
              <div className="hidden lg:flex flex-row items-center pl-0 pr-2 gap-0 relative">
                <span className="rounded-full bg-blue-800 text-white p-1">{initials}</span>
                <span className="ml-1 ">{userName}</span>
                <OutlinedIcon
                  className="bg-transparent absolute bottom-[-0.5rem] right-0"
                  name="arrow_drop_down"
                />
              </div>
            </button>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="relative flex flex-col h-full w-screen overflow-y-auto"
            aria-label="Main content"
          >
            {children}
            <SlideOut
              id="main-menu"
              open={mainMenuOpen}
              onClose={() => setMainMenuOpen(false)}
              dimBackground={false}
              className="border-t-0"
              left={mainMenuButtonRef.current?.getBoundingClientRect().left ?? 0}
              position="left"
            >
              <div role="navigation">
                <ul
                  className="flex flex-col list-none p-global"
                  aria-label="Main menu"
                >
                  <TopMenu />
                </ul>
              </div>
            </SlideOut>
            <SlideOut
              id="profile-menu"
              open={profileMenuOpen}
              onClose={() => {
                setProfileMenuOpen(false);
              }}
              dimBackground={false}
              className="border-t-0"
            >
              <NavbarProfileMenu
                onItemClick={() => setProfileMenuOpen(false)}
                userName={userName}
                initials={initials}
              />
            </SlideOut>
          </main>
        </div>
      </PageHeaderProvider>
    </ThemeProvider>
  );
};
