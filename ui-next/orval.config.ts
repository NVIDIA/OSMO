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
});
