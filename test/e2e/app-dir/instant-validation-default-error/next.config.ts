import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    instant: {
      defaultValidationLevel: 'error',
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
