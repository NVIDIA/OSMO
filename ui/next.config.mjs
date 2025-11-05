import { env } from "./src/env.mjs";

// Construct the API URL for proxying /api/* requests to the backend
// This handles both development and production scenarios where the UI needs to proxy to a backend service
const scheme = env.NEXT_PUBLIC_OSMO_SSL_ENABLED ? 'https' : 'http';
const API_URL = `${scheme}://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}`;

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  productionBrowserSourceMaps: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default config;
