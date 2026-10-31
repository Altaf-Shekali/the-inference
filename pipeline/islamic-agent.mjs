/**
 * Islamic Reminders Channel Generation Agent.
 *
 * Rotates through Quran-based reminders and verifies every verse and translation
 * against Quran.com before automatically rendering and publishing it.
 */
import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  loadIslamicContent,
  getApprovedRecord,
  getPendingUploadRecord,
  updateRecordStatus,
  addIslamicRecord,
  fetchVerifiedQuranVerse,
} from "./islamic-content.mjs";
import { channelUsedTopicsPath } from "./channels.mjs";
import { uploadVideo } from "./youtube.mjs";

const loadUsed = async (p) => {
  try {
    const records = JSON.parse(await fs.readFile(p, "utf8"));
    if (!Array.isArray(records)) throw new Error(`Invalid rotation history in ${p}`);
    return records;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, "..");
const OUT_DIR = path.join(ROOT, "out");
const SCRIPTS_DIR = path.join(DIR, "scripts");
const UPLOADS_FILE = path.join(DIR, "uploads.json");
const QURAN_ROTATION = [
  { sourceKey: "20:114", pillar: "dua", title: "A Prayer for Knowledge", template: "IslamicQuranReflection" },
  { sourceKey: "2:201", pillar: "dua", title: "A Prayer for Good in Both Worlds", template: "IslamicQuranReflection" },
  { sourceKey: "94:5", pillar: "quran", title: "With Hardship Comes Ease", template: "IslamicQuranReflection" },
  { sourceKey: "13:28", pillar: "reminder", title: "Hearts Find Peace Through Allah's Remembrance", template: "IslamicReminder" },
  { sourceKey: "39:53", pillar: "reminder", title: "Never Despair of Allah's Mercy", template: "IslamicReminder" },
  { sourceKey: "2:153", pillar: "quran", title: "Seek Help Through Patience and Prayer", template: "IslamicQuranReflection" },
  { sourceKey: "3:139", pillar: "reminder", title: "Do Not Lose Heart", template: "IslamicReminder" },
  { sourceKey: "65:3", pillar: "quran", title: "Place Your Trust in Allah", template: "IslamicQuranReflection" },
  { sourceKey: "14:7", pillar: "reminder", title: "Gratitude and Increase", template: "IslamicReminder" },
  { sourceKey: "93:3", pillar: "quran", title: "Your Lord Has Not Abandoned You", template: "IslamicQuranReflection" },
  { sourceKey: "3:173", pillar: "reminder", title: "Allah Is Sufficient for Us", template: "IslamicReminder" },
  { sourceKey: "29:69", pillar: "quran", title: "Guidance for Those Who Strive", template: "IslamicQuranReflection" },
];

export function chooseNextIslamicRotationItem(used, records) {
  const sourceKeyOf = (record) => {
    const source = record.source || {};
    return source.type === "quran" && source.surahNum && source.ayahNum
      ? `${source.surahNum}:${source.ayahNum}`
      : record.sourceKey || "";
  };
  const lastUsedKey = [...used].reverse().map(sourceKeyOf).find((key) => QURAN_ROTATION.some((item) => item.sourceKey === key));
  const lastRecordKey = [...records].reverse().map(sourceKeyOf).find((key) => QURAN_ROTATION.some((item) => item.sourceKey === key));
  const lastKey = lastUsedKey || lastRecordKey;
  const lastIndex = QURAN_ROTATION.findIndex((item) => item.sourceKey === lastKey);
  if (lastIndex >= 0) return QURAN_ROTATION[(lastIndex + 1) % QURAN_ROTATION.length];

  const alreadyUsed = new Set([...used, ...records].map(sourceKeyOf));
  return QURAN_ROTATION.find((item) => !alreadyUsed.has(item.sourceKey)) || QURAN_ROTATION[0];
}

async function recordUpload(entry) {
  let uploads = [];
  try {
    uploads = JSON.parse(await fs.readFile(UPLOADS_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!Array.isArray(uploads)) throw new Error("YouTube upload registry is not a JSON array.");
  uploads.push(entry);
  await fs.writeFile(UPLOADS_FILE, JSON.stringify(uploads, null, 2));
}

async function findUpload(base, channel) {
  let uploads = [];
  try {
    uploads = JSON.parse(await fs.readFile(UPLOADS_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!Array.isArray(uploads)) throw new Error("YouTube upload registry is not a JSON array.");
  return uploads.find((upload) => upload.base === base && upload.channel === channel) || null;
}

const TEMPLATE_MAP = {
  dhikr: "IslamicDhikrCounter",
  dua: "IslamicLearnDua",
  hadith: "IslamicCinematicHadith",
  quran: "IslamicQuranReflection",
  reminder: "IslamicReminder",
  quiz: "IslamicQuiz",
};

export async function runIslamic({
  channel,
  channelName = "Islamic Reminders",
  dateStr,
  doRender = false,
  doUpload = false,
  publishAt = null,
  pillar = null,
}) {
  console.log(`Agent: Islamic Reminders  |  ${channelName}  |  ${dateStr}`);

  const pendingUpload = await getPendingUploadRecord(channel.id, pillar);
  let record = pendingUpload || await getApprovedRecord(channel.id, pillar);
  const usedPath = channelUsedTopicsPath(channel.id);
  const used = await loadUsed(usedPath);

  if (!record) {
    console.log("① No ready record found. Selecting the next source-verified Quran item in the daily rotation.");
    const records = await loadIslamicContent(channel.id);
    const rotationItem = chooseNextIslamicRotationItem(used, records);
    const [surahNum, ayahNum] = rotationItem.sourceKey.split(":").map(Number);
    const verifiedContent = await fetchVerifiedQuranVerse(surahNum, ayahNum);

    record = await addIslamicRecord(channel.id, {
      pillar: rotationItem.pillar,
      title: rotationItem.title,
      religiousContent: {
        ...verifiedContent.religiousContent,
        context: rotationItem.pillar === "dua" ? "A supplication from the Quran." : "",
        reflection: "Pause and reflect on the guidance in this verse.",
      },
      source: verifiedContent.source,
      verification: {
        status: "VERIFICATION_PENDING",
        reviewer: "Automated Quran.com source verification",
        sourceVerified: true,
        arabicVerified: true,
        translationVerified: true,
        notes: `Verse ${rotationItem.sourceKey} and Saheeh International translation retrieved from Quran.com API.`,
      },
      video: {
        template: rotationItem.template,
        baseDate: dateStr,
        voiceover: false,
        soundEffects: true,
      },
    });
    record = await updateRecordStatus(channel.id, record.id, "APPROVED", {
      source: verifiedContent.source,
      religiousContent: {
        ...record.religiousContent,
        ...verifiedContent.religiousContent,
        context: rotationItem.pillar === "dua" ? "A supplication from the Quran." : "",
        reflection: "Pause and reflect on the guidance in this verse.",
      },
      verification: {
        sourceVerified: true,
        arabicVerified: true,
        translationVerified: true,
        reviewer: "Automated Quran.com source verification",
        notes: `Verse ${rotationItem.sourceKey} and Saheeh International translation retrieved from Quran.com API.`,
      },
    });
    console.log(`   ✓ Automatically approved after Quran.com verification: ${rotationItem.sourceKey}`);
  }

  console.log(`② Using ${record.verification?.status} content: "${record.title}" (${record.pillar})`);
  console.log(`   Source: ${record.source?.surahName} ${record.source?.surahNum}:${record.source?.ayahNum}`);

  // 2. Map record to template props
  const templateId = record.video?.template || TEMPLATE_MAP[record.pillar] || "IslamicDhikrCounter";
  let props = {};

  if (templateId === "IslamicDhikrCounter") {
    props = {
      arabic: record.religiousContent?.arabic || "أَسْتَغْفِرُ اللَّهَ",
      transliteration: record.religiousContent?.transliteration || "Astaghfirullāh",
      meaning: record.religiousContent?.translation || "I seek the forgiveness of Allah",
      targetCount: record.video?.targetCount || 33,
      countType: record.video?.countType || "sunnah-suggested",
      source: {
        collection: record.source?.collection || "Sahih Muslim",
        hadithNum: record.source?.hadithNum || "591",
        narrator: record.source?.narrator || "Thawban (RA)",
        authenticity: record.source?.authenticity || "Sahih",
      },
      theme: record.video?.theme || "midnight",
      channelName,
    };
  } else if (templateId === "IslamicLearnDua") {
    props = {
      title: record.title || "Learn an Authentic Dua",
      arabic: record.religiousContent?.arabic || "رَبِّ زِدْنِي عِلْمًا",
      transliteration: record.religiousContent?.transliteration || "Rabbi zidnī ʿilmā",
      meaning: record.religiousContent?.translation || "My Lord, increase me in knowledge.",
      context: record.religiousContent?.context || "Recite whenever seeking knowledge, studying, or clarity.",
      source: record.source?.surahName
        ? `Surah ${record.source.surahName} (${record.source.surahNum}:${record.source.ayahNum})`
        : record.source?.collection || "Authentic Dua",
      authenticity: record.source?.authenticity || "Quran",
      theme: record.video?.theme || "golden",
      channelName,
    };
  } else if (templateId === "IslamicCinematicHadith") {
    props = {
      topic: record.title || "Prophetic Guidance",
      narrator: record.source?.narrator || "",
      arabic: record.religiousContent?.arabic || "",
      hadithText: record.religiousContent?.translation || "",
      collection: record.source?.collection || "Sahih Bukhari",
      hadithNum: record.source?.hadithNum || "",
      authenticity: record.source?.authenticity || "Sahih",
      theme: record.video?.theme || "emerald",
      channelName,
    };
  } else if (templateId === "IslamicQuranReflection") {
    props = {
      surahName: record.source?.surahName || "Al-Quran",
      surahNum: record.source?.surahNum || 1,
      ayahNum: record.source?.ayahNum || 1,
      arabic: record.religiousContent?.arabic || "",
      translation: record.religiousContent?.translation || "",
      reflection: record.religiousContent?.reflection || "Reflect upon the signs of Allah.",
      theme: record.video?.theme || "midnight",
      channelName,
    };
  } else {
    props = {
      title: record.title || "Daily Islamic Reminder",
      arabic: record.religiousContent?.arabic || "",
      reminderText: record.religiousContent?.translation || record.title || "",
      supportingEvidence: record.source?.type === "quran"
        ? `Surah ${record.source.surahName} (${record.source.surahNum}:${record.source.ayahNum})`
        : record.source?.collection || record.source?.surahName || "Authentic Sunnah",
      theme: record.video?.theme || "golden",
      channelName,
    };
  }

  // 3. Write props and metadata to disk
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });

  const recordDate = record.video?.baseDate || record.createdAt?.slice(0, 10) || dateStr;
  const baseSlug = `${recordDate}-islamic-${record.id}`;
  const propsFile = path.join(OUT_DIR, `${baseSlug}.short.props.json`);
  const metaFile = path.join(SCRIPTS_DIR, `${baseSlug}.meta.json`);
  const mp4File = path.join(OUT_DIR, `${baseSlug}.short.mp4`);

  await fs.writeFile(propsFile, JSON.stringify(props, null, 2), "utf8");

  const isQuranSource = record.source?.type === "quran";
  const sourceLabel = isQuranSource
    ? `Surah ${record.source.surahName} (${record.source.surahNum}:${record.source.ayahNum})`
    : record.source?.collection || record.source?.surahName || "Authentic Islamic Sources";
  const tags = isQuranSource
    ? ["islamic reminders", "quran", record.pillar === "dua" ? "quranic dua" : "quran reflection"]
    : ["islamic reminders", "dhikr", "hadith", "dua"];
  const meta = {
    channel: channel.id,
    title: `${record.title} | ${channelName} #Shorts`,
    description: `${record.religiousContent?.translation || record.title}\n\n` +
      `${isQuranSource ? "Quran" : "Authentic"} Reference: ${sourceLabel}\n` +
      `${record.source?.sourceUrl ? `Source: ${record.source.sourceUrl}\n` : ""}` +
      `Channel: ${channelName}\n` +
      `${isQuranSource ? `#shorts #islamicreminders #quran${record.pillar === "dua" ? " #dua" : ""}` : "#shorts #islamicreminders #hadith #dhikr"}`,
    tags,
    renderedAt: new Date().toISOString(),
    recordId: record.id,
  };
  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), "utf8");
  console.log(`② Saved props: ${path.relative(ROOT, propsFile)}`);

  // 4. Render if requested
  const uploadPending = record.verification?.status === "UPLOAD_PENDING";
  const renderedFileExists = await fs.access(mp4File).then(() => true).catch((error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (doRender && !(uploadPending && renderedFileExists)) {
    console.log(`③ Rendering ${templateId} with Remotion...`);
    const cmd = `npx remotion render ${templateId} "${mp4File}" --props="${propsFile}" --concurrency=1`;
    try {
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
      console.log(`   ✓ Rendered video: ${path.relative(ROOT, mp4File)}`);
    } catch (err) {
      console.error(`   ✗ Render failed: ${err.message}`);
      throw err;
    }
  }

  if (doRender) {
    record = await updateRecordStatus(channel.id, record.id, doUpload ? "UPLOAD_PENDING" : "RENDERED", {
      renderedFile: path.relative(ROOT, mp4File),
    });
    if (!used.some((entry) => entry.id === record.id)) {
      used.push({
        date: dateStr,
        title: record.title,
        id: record.id,
        pillar: record.pillar,
        sourceKey: `${record.source.surahNum}:${record.source.ayahNum}`,
      });
      await fs.mkdir(path.dirname(usedPath), { recursive: true });
      await fs.writeFile(usedPath, JSON.stringify(used, null, 2), "utf8");
    }
  }

  // 5. Upload if requested and enabled
  if (doUpload && channel.enabled) {
    if (!renderedFileExists && !doRender) {
      throw new Error(`Missing ${path.relative(ROOT, mp4File)} — render it before uploading.`);
    }
    if (record.verification?.status !== "UPLOAD_PENDING") {
      record = await updateRecordStatus(channel.id, record.id, "UPLOAD_PENDING");
    }

    const existingUpload = await findUpload(baseSlug, channel.id);
    if (existingUpload) {
      record = await updateRecordStatus(channel.id, record.id, "PUBLISHED", {
        youtubeVideoId: existingUpload.videoId,
      });
      console.log(`   ✓ Recovered existing YouTube upload: ${existingUpload.url}`);
    } else {
      console.log("④ Uploading to YouTube...");
      const privacyStatus = channel.privacy || "private";
      const uploaded = await uploadVideo(mp4File, {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: "27",
        privacyStatus,
        publishAt,
      }, channel.id);
      if (!uploaded.id) throw new Error("YouTube upload completed without returning a video ID.");
      const url = `https://youtu.be/${uploaded.id}`;
      await recordUpload({
        base: baseSlug,
        channel: channel.id,
        kind: "short",
        videoId: uploaded.id,
        url,
        privacy: publishAt ? "scheduled" : privacyStatus,
        publishAt: publishAt || null,
        title: meta.title,
        at: new Date().toISOString(),
      });
      record = await updateRecordStatus(channel.id, record.id, "PUBLISHED", {
        youtubeVideoId: uploaded.id,
      });
      console.log(`   ✓ Published to YouTube: ${url}`);
    }
  }

  return { record, rendered: doRender, mp4File };
}
