/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output trims node_modules to just what the server needs,
  // so the Docker runtime image stays small.
  output: "standalone",
};

export default nextConfig;
