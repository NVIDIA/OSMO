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
