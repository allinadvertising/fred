/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX || undefined,
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /browserslist[\\/]+node\.js/,
        message: /Critical dependency: require function is used in a way/
      }
    ];
    return config;
  }
};

export default nextConfig;
