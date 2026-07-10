/**
 * Publish a finished video to YouTube.
 *
 *   npm run publish <base>                 # upload as PRIVATE (review then go live)
 *   npm run publish <base> --unlisted      # upload as UNLISTED
 *   npm run publish <base> --public         # PUBLIC (only works once your API project is audited)
 *   npm run publish <base> --at=2026-06-20T14:00:00Z   # schedule a public release (RFC3339 UTC)
 *   npm run publish <base> --short          # upload out/<base>.short.mp4 as a YouTube Short
 *
 * Expects out/<base>.mp4 and pipeline/scripts/<base>.meta.json (title/description/tags/thumbnail).
 * Renders the thumbnail still automatically. Every successful upload is recorded
 * to pipeline/uploads.json so the dashboard can show status + the YouTube link.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { uploadVideo, setThumbnail, hasYouTube } from "./youtube.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = path.join(ROOT, "pipeline", "uploads.json");

/** append one upload record to pipeline/uploads.json (read-modify-write) */
async function recordUpload(entry) {
  let arr = [];
  try {
    arr = JSON.parse(await fs.readFile(REGISTRY, "utf8"));
  } catch {
    arr = [];
  }
  arr.push(entry);
  await fs.writeFile(REGISTRY, JSON.stringify(arr, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const base = args.find((a) => !a.startsWith("--"));
  const channel = args.find((a) => a.startsWith("--channel="))?.slice(10) || "the-inference";
  if (!base) {
    console.error("Usage: npm run publish <base> [--unlisted|--public|--at=ISO] [--short] [--channel=<id>]");
    process.exit(1);
  }
  if (!hasYouTube(channel)) {
    console.error(`YouTube not authorized for channel "${channel}". Run \`npm run yt-auth -- --channel=${channel}\`.`);
    process.exit(1);
  }

  const isShort = args.includes("--short");
  const videoPath = path.join(ROOT, "out", `${base}${isShort ? ".short" : ""}.mp4`);
  const metaPath = path.join(ROOT, "pipeline", "scripts", `${base}.meta.json`);
  await fs.access(videoPath).catch(() => { throw new Error(`missing ${path.relative(ROOT, videoPath)} — render it first`); });
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));

  // YouTube classifies a vertical video as a Short when "#Shorts" is in the
  // title/description. Add it for short uploads (don't duplicate if present).
  if (isShort) {
    if (!/#shorts/i.test(meta.description || "")) meta.description = `${meta.description || ""}\n\n#Shorts`.trim();
    if (!/#shorts/i.test(meta.title || "") && (meta.title || "").length <= 90) meta.title = `${meta.title} #Shorts`;
  }

  const at = args.find((a) => a.startsWith("--at="))?.slice(5);
  const privacyStatus = args.includes("--public") ? "public" : args.includes("--unlisted") ? "unlisted" : "private";

  // render the thumbnail still from meta.thumbnail
  let thumbPath = "";
  if (meta.thumbnail) {
    const thumbProps = path.join(ROOT, "out", `${base}.thumb.props.json`);
    thumbPath = path.join(ROOT, "out", `${base}.thumb.png`);
    await fs.writeFile(thumbProps, JSON.stringify(meta.thumbnail));
    console.log("Rendering thumbnail…");
    execSync(`npx remotion still AINewsThumbnail "${thumbPath}" --props="${thumbProps}"`, { cwd: ROOT, stdio: "ignore" });
  }

  console.log(`Uploading ${base}.mp4 as ${at ? "scheduled" : privacyStatus}…`);
  const video = await uploadVideo(
    videoPath,
    {
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      categoryId: meta.categoryId,
      privacyStatus,
      publishAt: at,
    },
    channel,
  );
  const url = `https://youtu.be/${video.id}`;
  console.log(`✓ Uploaded: ${url}`);
  await recordUpload({
    base,
    channel,
    kind: isShort ? "short" : "long",
    videoId: video.id,
    url,
    privacy: at ? "scheduled" : privacyStatus,
    publishAt: at || null,
    title: meta.title,
    at: new Date().toISOString(),
  });

  if (thumbPath) {
    try {
      await setThumbnail(video.id, thumbPath, channel);
      console.log("✓ Thumbnail set");
    } catch (e) {
      console.warn(`thumbnail upload skipped: ${e.message}`);
    }
  }
  console.log(at ? `Scheduled to go public at ${at}.` : `Status: ${privacyStatus}. Review in YouTube Studio, then publish.`);
}

main().catch((e) => {
  console.error("Publish failed:", e.message);
  process.exit(1);
});
