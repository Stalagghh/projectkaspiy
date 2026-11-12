import type { NextConfig } from 'next';

// Security headers applied to every route. CSP comes later (polish phase).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), microphone=(), camera=()' },
];

const nextConfig: NextConfig = {
  // Documented fallback in PLAN.md: every page renders at request time.
  cacheComponents: false,
  // Workspace packages export TypeScript sources that import siblings with .ts extensions.
  transpilePackages: ['@ecoshield/contracts', '@ecoshield/db'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
