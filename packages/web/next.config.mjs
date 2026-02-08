import { createMDX } from 'fumadocs-mdx/next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
  // Temporarily disabled for Next.js 16 compatibility
  // turbopack: {
  //   root: path.resolve(__dirname, '../../'),
  //   rules: {
  //     '*.{jsx,tsx}': {
  //       loaders: [loaderPath],
  //     },
  //   },
  // },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
