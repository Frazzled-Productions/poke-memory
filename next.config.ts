import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The FSRS optimizer route loads @open-spaced-repetition/binding which
  // ships a native Node.js binary (.node). Mark it (and its platform-specific
  // sub-package) as server-external so Next.js/Turbopack does not attempt to
  // bundle them — they are loaded at runtime by Node's native addon loader.
  serverExternalPackages: [
    "@open-spaced-repetition/binding",
    "@open-spaced-repetition/binding-android-arm64",
    "@open-spaced-repetition/binding-darwin-arm64",
    "@open-spaced-repetition/binding-darwin-x64",
    "@open-spaced-repetition/binding-linux-arm64-gnu",
    "@open-spaced-repetition/binding-linux-arm64-musl",
    "@open-spaced-repetition/binding-linux-x64-gnu",
    "@open-spaced-repetition/binding-linux-x64-musl",
    "@open-spaced-repetition/binding-wasm32-wasi",
    "@open-spaced-repetition/binding-win32-arm64-msvc",
    "@open-spaced-repetition/binding-win32-ia32-msvc",
    "@open-spaced-repetition/binding-win32-x64-msvc",
  ],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version ?? "dev",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
