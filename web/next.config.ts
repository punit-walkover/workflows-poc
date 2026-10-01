import type { NextConfig } from 'next';

// API_ORIGIN (deploy): the browser calls /api on this site and Next forwards it to the API server, so no CORS is needed.
const nextConfig: NextConfig = {
  devIndicators: false, // the dev badge would overlap the embedded widget
  async rewrites() {
    return process.env.API_ORIGIN ? [{ source: '/api/:path*', destination: `${process.env.API_ORIGIN}/:path*` }] : [];
  },
};

export default nextConfig;
