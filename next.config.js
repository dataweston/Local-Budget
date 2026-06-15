/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // @vercel/blob (and its undici dep) are server-only; bundling them makes
    // webpack parse undici's modern syntax and fail. Keep them external.
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs', '@vercel/blob'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive, nosnippet, noimageindex',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
