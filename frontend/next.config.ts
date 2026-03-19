import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.API_URL || 'http://noap-backend:4000/api/v1/:path*'
      }
    ]
  }
};

export default nextConfig;
