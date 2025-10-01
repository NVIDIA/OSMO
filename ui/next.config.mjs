import { env } from "./src/env.mjs";

const API_URL = env.NODE_ENV === 'development' && !env.NEXT_PUBLIC_OSMO_API_HOSTNAME.includes(":") ? `https://${env.NEXT_PUBLIC_OSMO_API_HOSTNAME}` : '';

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
