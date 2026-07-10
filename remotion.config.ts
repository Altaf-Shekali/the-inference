// See all configuration options: https://remotion.dev/docs/config
// Each option also is available as a CLI flag: https://remotion.dev/docs/cli

// Note: When using the Node.JS APIs, the config file doesn't apply. Instead, pass options directly to the APIs

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig(enableTailwind);
// B-roll uses OffthreadVideo. The original crash was the decoded-frame cache
// growing unbounded across several clips, which forced single-worker renders.
// That's now mitigated on two fronts — clips are normalized to 720p/30fps in
// build.mjs (normalizeClip), and the cache below is hard-capped — so multiple
// workers are safe. 4 workers (of 12 cores) trades render speed for bounded
// peak memory; raise carefully and re-verify a multi-clip render if you bump it.
Config.setConcurrency(4);
Config.setOffthreadVideoCacheSizeInBytes(200 * 1024 * 1024); // 200 MB cap
// Give footage frame extraction more headroom before timing out.
Config.setDelayRenderTimeoutInMilliseconds(60000);
