/**
 * YouTube Data API v3 uploader (OAuth2).
 *
 * Setup (one time):
 *   1. Google Cloud Console → new project → enable "YouTube Data API v3".
 *   2. OAuth consent screen → External → add yourself as a test user.
 *   3. Credentials → Create OAuth client ID → type "Desktop app" → download JSON
 *      → save it as pipeline/youtube.client.json.
 *   4. Run `npm run yt-auth` once to authorize your channel (creates youtube.token.json).
 *
 * Then `npm run publish <base>` uploads out/<base>.mp4 with its meta + thumbnail.
 */
import { promises as fs, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { channelTokenPath } from "./channels.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

const readLocal = (f) => {
  try {
    return readFileSync(path.join(DIR, f), "utf8").trim();
  } catch {
    return "";
  }
};

/** OAuth client for a channel — its own channels/<id>/youtube.client.json if
 *  present, else the shared pipeline/youtube.client.json. */
export function loadClient(channelId) {
  let raw = "";
  if (channelId) {
    try {
      raw = readFileSync(path.join(DIR, "channels", channelId, "youtube.client.json"), "utf8").trim();
    } catch {
      /* fall back to shared */
    }
  }
  if (!raw) raw = readLocal("youtube.client.json");
  if (!raw) return null;
  const j = JSON.parse(raw);
  const c = j.installed || j.web || j; // Google downloads wrap creds under "installed"
  return c.client_id && c.client_secret ? { id: c.client_id, secret: c.client_secret } : null;
}

/** load a channel's token (channelId → its per-channel token; default → legacy) */
export const loadToken = (channelId = "the-inference") => {
  try {
    return JSON.parse(readFileSync(channelTokenPath(channelId), "utf8"));
  } catch {
    return null;
  }
};

export const hasYouTube = (channelId) => !!loadClient(channelId) && !!loadToken(channelId)?.refresh_token;

/** exchange the stored refresh token for a short-lived access token */
export async function getAccessToken(channelId) {
  const c = loadClient(channelId);
  const t = loadToken(channelId);
  if (!c) throw new Error("Missing pipeline/youtube.client.json (download an OAuth Desktop client).");
  if (!t?.refresh_token) throw new Error("Not authorized yet — run `npm run yt-auth`.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: "refresh_token" }),
  });
  if (!r.ok) {
    const body = await r.text();
    if (body.includes("invalid_grant")) {
      throw new Error(
        "YouTube authorization expired or revoked. Re-run `npm run yt-auth` to re-authorize.\n" +
          "  To stop this recurring (~weekly): in Google Cloud Console → OAuth consent screen, click 'PUBLISH APP'\n" +
          "  (Testing mode expires refresh tokens after 7 days).",
      );
    }
    throw new Error(`token refresh ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()).access_token;
}

/**
 * Upload a video (resumable). meta: { title, description, tags[], categoryId?,
 * privacyStatus?, publishAt? }. Returns the created video resource (has .id).
 */
export async function uploadVideo(videoPath, meta, channelId) {
  const token = await getAccessToken(channelId);
  const body = {
    snippet: {
      title: (meta.title || "Untitled").slice(0, 100),
      description: (meta.description || "").slice(0, 4900),
      tags: (meta.tags || []).slice(0, 30),
      categoryId: meta.categoryId || "28", // 28 = Science & Technology, 25 = News
    },
    status: {
      privacyStatus: meta.publishAt ? "private" : meta.privacyStatus || "private",
      selfDeclaredMadeForKids: false,
    },
  };
  if (meta.publishAt) body.status.publishAt = meta.publishAt; // RFC3339, schedules a public release

  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/*" },
    body: JSON.stringify(body),
  });
  if (!init.ok) throw new Error(`upload init ${init.status}: ${(await init.text()).slice(0, 300)}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("no resumable upload URL returned");

  const bytes = await fs.readFile(videoPath);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/*", "Content-Length": String(bytes.length) }, body: bytes });
  if (!put.ok) throw new Error(`upload ${put.status}: ${(await put.text()).slice(0, 300)}`);
  return put.json();
}

/** set a custom thumbnail (png/jpg) on an uploaded video */
export async function setThumbnail(videoId, thumbPath, channelId) {
  const token = await getAccessToken(channelId);
  const bytes = await fs.readFile(thumbPath);
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`thumbnail ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
