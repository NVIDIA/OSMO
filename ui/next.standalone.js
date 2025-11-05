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
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { env } from "./src/env.mjs";

const appDir = import.meta.dirname || dirname(fileURLToPath(import.meta.url));
// Construct the API URL for proxying /api/* requests to the backend
// This handles both development and production scenarios where the UI needs to proxy to a backend service
const scheme = env.NEXT_PUBLIC_OSMO_SSL_ENABLED ? 'https' : 'http';
const API_URL = `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}`;

// Import mini-css-extract-plugin at the top level to avoid SSR issues
let MiniCssExtractPlugin;
try {
  const module = await import('mini-css-extract-plugin');
  MiniCssExtractPlugin = module.default;
} catch (error) {
  console.warn('mini-css-extract-plugin not available:', error.message);
}

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  productionBrowserSourceMaps: true,
  trailingSlash: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
      },
    ],
  },
  webpack: (config, { isServer, dev }) => {
    if (!isServer && MiniCssExtractPlugin) {
      // For client-side builds, use mini-css-extract-plugin to extract CSS into separate files
      // This avoids the SSR issues that style-loader has with document references
      config.plugins.push(new MiniCssExtractPlugin({
        filename: dev ? '[name].css' : 'static/css/[name].[contenthash].css',
        chunkFilename: dev ? '[id].css' : 'static/css/[id].[contenthash].css',
        ignoreOrder: true, // Enable to remove warnings about conflicting order
      }));

      // Ensure CSS files are properly handled
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...config.optimization.splitChunks,
          cacheGroups: {
            ...config.optimization.splitChunks?.cacheGroups,
            styles: {
              name: 'styles',
              test: /\.css$/,
              chunks: 'all',
              enforce: true,
            },
          },
        },
      };

      config.module.rules.push({
        test: /\.css$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
            options: {
              publicPath: '/_next/',
            },
          },
          {
            loader: "css-loader",
            options: {
              importLoaders: 1,
            },
          },
          "postcss-loader"
        ],
      });
    } else {
      // For server-side builds, use null-loader to avoid DOM access
      config.module.rules.push({
        test: /\.css$/,
        use: ["null-loader"],
      });
    }

    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },

    ];
  },

  experimental: {
    outputFileTracingRoot: join(appDir, "../../"),
    outputFileTracingIncludes: {
      "*": [
        "node_modules/@next/env/**",
        "node_modules/@swc/helpers/**",
        "node_modules/next/**",
        "node_modules/sharp/**",
        "node_modules/styled-jsx/**",
      ],
    },
    outputFileTracingExcludes: {
      "*": [
        // We need to exclude this because it is symlinked to outside of the output dir
        // which causes Bazel sandbox validation to fail. See BUILD's `react_overlay_tar`
        // rule for more details.
        "node_modules/react/**",
      ],
    },
  },
};

export default config;
