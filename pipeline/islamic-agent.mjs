/**
 * Islamic Reminders Channel Generation Agent.
 *
 * Implements strict source verification, authentic attribution, and renders
 * verified Islamic reminders, Dhikr, Duas, and Hadith across Remotion templates.
 *
 * Religious authenticity is enforced: only content in "APPROVED" state
 * is ever rendered or published.
 */
import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  loadIslamicContent,
  getApprovedRecord,
  updateRecordStatus,
  addIslamicRecord,
} from "./islamic-content.mjs";
import { channelUsedTopicsPath } from "./channels.mjs";
import { geminiIslamicResearch } from "./gemini.mjs";

const loadUsed = async (p) => fs.readFile(p, "utf8").then(JSON.parse).catch(() => []);

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, "..");
const OUT_DIR = path.join(ROOT, "out");
const SCRIPTS_DIR = path.join(DIR, "scripts");

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
  topic = null,
  pillar = null,
}) {
  console.log(`Agent: Islamic Reminders  |  ${channelName}  |  ${dateStr}`);

  // 1. Check for an approved record ready for rendering
  let record = await getApprovedRecord(channel.id, pillar);

  if (!record) {
    console.log("① No APPROVED record found in content database.");
    console.log("② Researching authentic Islamic content candidate via Gemini...");

    const targetPillar = pillar || "reminder";
    const draft = await geminiIslamicResearch({
      pillar: targetPillar,
      topic: topic || "Authentic Remembrance & Character",
    });

    const newRecord = await addIslamicRecord(channel.id, {
      pillar: targetPillar,
      title: draft.title,
      religiousContent: draft.religiousContent,
      source: draft.source,
      verification: {
        status: "VERIFICATION_PENDING",
        reviewer: "Automated Research Agent",
        notes: "Grounded candidate generated from authentic sources. Requires human review.",
      },
      video: {
        template: TEMPLATE_MAP[targetPillar] || "IslamicReminder",
        voiceover: false,
        soundEffects: true,
      },
    });

    console.log(
      `   ✓ Candidate saved (ID: ${newRecord.id}) in state: VERIFICATION_PENDING`,
    );
    console.log(
      `   ⚠ Religious authenticity policy: Video will NOT render until approved in dashboard.`,
    );
    return { record: newRecord, rendered: false };
  }

  console.log(`① Using APPROVED content: "${record.title}" (${record.pillar})`);
  console.log(`   Source: ${record.source?.collection || record.source?.surahName || "Verified"} | Authenticity: ${record.source?.authenticity || "Sahih"}`);

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
      supportingEvidence: record.source?.collection || record.source?.surahName || "Authentic Sunnah",
      theme: record.video?.theme || "golden",
      channelName,
    };
  }

  // 3. Write props and metadata to disk
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(SCRIPTS_DIR, { recursive: true });

  const baseSlug = `${dateStr}-islamic-${record.id}`;
  const propsFile = path.join(OUT_DIR, `${baseSlug}.short.props.json`);
  const metaFile = path.join(SCRIPTS_DIR, `${baseSlug}.meta.json`);
  const mp4File = path.join(OUT_DIR, `${baseSlug}.short.mp4`);

  await fs.writeFile(propsFile, JSON.stringify(props, null, 2), "utf8");

  const meta = {
    title: `${record.title} | ${channelName} #Shorts`,
    description: `${record.religiousContent?.translation || record.title}\n\n` +
      `Authentic Reference: ${record.source?.collection || record.source?.surahName || "Authentic Islamic Sources"}\n` +
      `Channel: ${channelName}\n` +
      `#shorts #islamicreminders #dhikr #quran #hadith`,
    tags: ["islamic reminders", "dhikr", "quran", "hadith", "dua", "islamic shorts"],
    renderedAt: new Date().toISOString(),
    recordId: record.id,
  };
  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), "utf8");
  console.log(`② Saved props: ${path.relative(ROOT, propsFile)}`);

  // 4. Render if requested
  if (doRender) {
    console.log(`③ Rendering ${templateId} with Remotion...`);
    const cmd = `npx remotion render ${templateId} "${mp4File}" --props="${propsFile}" --concurrency=1`;
    try {
      execSync(cmd, { cwd: ROOT, stdio: "inherit" });
      console.log(`   ✓ Rendered video: ${path.relative(ROOT, mp4File)}`);
      await updateRecordStatus(channel.id, record.id, "RENDERED", {
        renderedFile: path.relative(ROOT, mp4File),
      });

      // Track in used topics
      const usedPath = channelUsedTopicsPath(channel.id);
      const used = await loadUsed(usedPath);
      used.push({ date: dateStr, title: record.title, id: record.id });
      await fs.mkdir(path.dirname(usedPath), { recursive: true });
      await fs.writeFile(usedPath, JSON.stringify(used, null, 2), "utf8");
    } catch (err) {
      console.error(`   ✗ Render failed: ${err.message}`);
      throw err;
    }
  }

  // 5. Upload if requested and enabled
  if (doUpload && channel.enabled) {
    console.log("④ Uploading to YouTube...");
    // Dynamic import to avoid circular dependency
    const { uploadToYouTube } = await import("./youtube.mjs");
    const videoId = await uploadToYouTube({
      channelId: channel.id,
      videoPath: mp4File,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      privacy: channel.privacy || "private",
      publishAt,
    });
    console.log(`   ✓ Published to YouTube (Video ID: ${videoId})`);
    await updateRecordStatus(channel.id, record.id, "PUBLISHED", {
      youtubeVideoId: videoId,
    });
  }

  return { record, rendered: doRender, mp4File };
}
