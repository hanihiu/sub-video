import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Vinext applies this request-body guard before the route handler.
      // Keep it aligned with the upload validation in /api/transcribe.
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
