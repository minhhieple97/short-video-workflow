import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "bullmq", "ioredis"],
};

export default nextConfig;
