/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: { bodySizeLimit: '200mb' },
  },
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core-linux-x64-gnu',
      'node_modules/@swc/core-linux-x64-musl',
      'node_modules/@esbuild/linux-x64',
    ],
  },
  webpack: (config) => {
    // pdfjs-dist ships a worker file we don't want webpack to try to bundle
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
