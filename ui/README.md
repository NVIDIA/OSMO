<!--
  Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

# NVIDIA OSMO - UI

## Core Technologies

- [Next.js](https://nextjs.org)
- [tRPC](https://trpc.io)

## Local Development

Assuming the current working directory is `ui/`...

Make sure the correct version of npm is installed
**npm**: 10.9.3
**node**: v22.17.1

First, install dependencies:

- `npm i`

Then, run locally:

- `npm run dev`

Additional commands:

- Lint: `npm run lint`
- Prod Build: `npm run build`
- Prod Serve: `npm run start`. NOTE, this command simply serves an _existing_ prod build. So you should run `npm run build` first.

To update packages:
npm install           # produce/update ui/package-lock.json
bazel run -- @pnpm//:pnpm --dir $PWD import  # writes ui/pnpm-lock.yaml

#### Running the frontend against different environments

The frontend can run against different environments, both deployed and local. Create a `.env.local` file in the `ui/` directory with the appropriate configuration:

**Local service** - Connect to a locally running service
```
NEXT_PUBLIC_OSMO_API_HOSTNAME=<local machine IP>:8000
NEXT_PUBLIC_OSMO_SSL_ENABLED=false
```

**Cloud service** - Local frontend against cloud environment
```
AUTH_CLIENT_SECRET="<cloud auth client secret>"
NEXT_PUBLIC_OSMO_API_HOSTNAME=<cloud base URL>
NEXT_PUBLIC_OSMO_AUTH_HOSTNAME=<cloud base auth URL>
```

### Theming
The app name can be controlled via the following environment variable
```
NEXT_PUBLIC_APP_NAME=<App Name>
```
For colors, see the following in global.css
```
--color-brand: Main brand color of the application
--color-text: Global color for all text in the website;
--color-bg: Body color;
--color-border: Borders around components;
--color-footerbg: Footers of tables and popups;
--color-headerbg: Header of tables and popups;
```
## Structure of the Repo

- There is a `/components` folder, with code that is shared across different sections of the repository.
  - Sections such as `/app/datasets` will have their own `/app/datasets/components` folder to account for components (almost) exclusive to those sections
- To make API fetches to our service, use `OsmoApiFetch` from `common.ts` as it abstracts away a lot of the boilerplate of fetching to the service
- Zod Models for data requests and responses are found within `/models/*-model.ts`
- There is a standard error response format returned by the service, called `OSMOErrorResponse`. You can use the `OSMOErrorResponseSchema` to parse it or cast your response type to this while including a message as well.

## Visual Code / Cursor recommendations

The repo has eslint and prettier setup and will automatically format source files when saved (see .vscode/settings.json). To integrate eslint, prettier and more into your Code Editor, the following extensions are recommended

### VSCode Extensions

- ESLint
- Prettier ESLint
- Prettier - Code formatter

Also

- Git Blame
- Git Graph
- PostgresSQL
- Tailwind CSS IntelliSense
