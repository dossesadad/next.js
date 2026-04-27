import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    instant: {
      defaultValidationLevel: 'warning',
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
