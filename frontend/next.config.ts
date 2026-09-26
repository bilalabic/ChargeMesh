import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @chargemesh/shared ships raw TypeScript sources.
  transpilePackages: ["@chargemesh/shared"],
};

export default nextConfig;
