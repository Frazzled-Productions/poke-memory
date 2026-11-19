// OpenNext for Cloudflare (decision 0018, design D1). Nothing in the app
// revalidates at runtime (no cacheTag, updateTag or revalidateTag call), so the
// incremental cache is the read-only static-assets cache and cache
// interception is off: no R2 or KV cache binding is needed.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: false,
});
