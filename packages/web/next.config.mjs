import { createMDX } from 'fumadocs-mdx/next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseHostname(url) {
  if (!url) return null;
  try {
    return new globalThis.URL(url).hostname;
  } catch {
    return null;
  }
}

const supabaseHostname = parseHostname(globalThis.process?.env?.NEXT_PUBLIC_SUPABASE_URL);
const imageRemotePatterns = [
  {
    protocol: "https",
    hostname: "avatars.githubusercontent.com",
  },
  {
    protocol: "https",
    hostname: "api.producthunt.com",
  },
  {
    protocol: "https",
    hostname: "lh3.googleusercontent.com",
  },
  {
    protocol: "https",
    hostname: "*.googleusercontent.com",
  },
];

if (supabaseHostname) {
  imageRemotePatterns.push({
    protocol: "https",
    hostname: supabaseHostname,
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: imageRemotePatterns,
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
