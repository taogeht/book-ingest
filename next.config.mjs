/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  experimental: {
    serverActions: { bodySizeLimit: '200mb' },
  },
  // Empty turbopack config is the recommended way to silence the "webpack +
  // no turbopack" warning on Next 16 when we don't actually need to customize
  // either. pdfjs-dist/legacy works as-is in node runtime without aliases.
  turbopack: {},
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core-linux-x64-gnu',
      'node_modules/@swc/core-linux-x64-musl',
      'node_modules/@esbuild/linux-x64',
    ],
  },
};

export default nextConfig;
