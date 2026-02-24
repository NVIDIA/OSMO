// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'orval';

export default defineConfig({
  osmo: {
    input: {
      target: './openapi.json',
    },
    output: {
      target: './src/lib/api/generated.ts',
      client: 'react-query',
      mode: 'single',
      override: {
        mutator: {
          path: './src/lib/api/fetcher.ts',
          name: 'customFetch',
        },
      },
    },
  },
  // Generate type-safe mock data from OpenAPI spec
  'osmo-mocks': {
    input: {
      target: './openapi.json',
    },
    output: {
      target: './e2e/mocks/generated-mocks.ts',
      mode: 'single',
      client: 'fetch',
      mock: {
        type: 'msw',
        delay: 0,
      },
      override: {
        // Use faker for realistic data
        mock: {
          properties: {
            // Customize specific fields for realistic data
            '/.*name.*/': () => `pool-${Math.random().toString(36).slice(2, 7)}`,
            '/.*hostname.*/': () => `node-${Math.random().toString(36).slice(2, 7)}.cluster.local`,
            '/.*description.*/': 'A test resource',
          },
        },
      },
    },
  },
});
