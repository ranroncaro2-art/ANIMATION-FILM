import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["localhost:3001", "127.0.0.1:3001", "192.168.1.3", "192.168.1.3:3001"]
};

export default nextConfig;
