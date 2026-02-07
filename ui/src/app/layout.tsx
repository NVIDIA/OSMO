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
import { type ReactNode } from "react";

import { headers } from "next/headers";
import Script from "next/script";

import { AuthProvider } from "~/components/AuthProvider";
import { Layout } from "~/components/Layout";
import { StoreProvider } from "~/components/StoreProvider";
import { env } from "~/env.mjs";
import { RuntimeEnvProvider } from "~/runtime-env";
import { TRPCReactProvider } from "~/trpc/react";

import "../styles/globals.css";

export const metadata = {
  title: `${env.NEXT_PUBLIC_APP_NAME} Dashboard`,
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body>
        <RuntimeEnvProvider
          value={{
            DOCS_BASE_URL: env.DOCS_BASE_URL,
            CLI_INSTALL_SCRIPT_URL: env.CLI_INSTALL_SCRIPT_URL,
            PORT_FORWARD_ENABLED: env.NEXT_PUBLIC_OSMO_PORT_FORWARD_ENABLED,
          }}
        >
          <TRPCReactProvider headers={headers()}>
            <AuthProvider>
              <StoreProvider>
                <Layout>{children}</Layout>
              </StoreProvider>
            </AuthProvider>
          </TRPCReactProvider>
        </RuntimeEnvProvider>
        <Script
          src="/osmo-scripts.cjs"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
