import type { NextConfig } from "next";

// Static export only: no Ambit server, no customer data on Ambit hosting.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
