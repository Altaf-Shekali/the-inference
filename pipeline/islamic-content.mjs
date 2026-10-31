/**
 * Islamic Content and Source Verification Database Manager.
 *
 * Manages structured Islamic content records and source verification.
 *
 * Lifecycle:
 * DISCOVERED -> SOURCED -> DRAFTED -> VERIFIED -> APPROVED -> RENDERED -> UPLOAD_PENDING -> PUBLISHED
 *                                                               \-> REJECTED
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

export const ISLAMIC_PILLARS = [
  "dhikr",
  "hadith",
  "quran",
  "dua",
  "reminder",
  "quiz",
  "stories",
];

export const VERIFICATION_STATUSES = [
  "DISCOVERED",
  "SOURCED",
  "DRAFTED",
  "VERIFICATION_PENDING",
  "APPROVED",
  "REJECTED",
  "RENDERED",
  "UPLOAD_PENDING",
  "PUBLISHED",
];

function getDbPath(channelId = "islamic-reminders") {
  return path.join(DIR, "channels", channelId, "content-db.json");
}

function cleanTranslation(text) {
  return text
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchVerifiedQuranVerse(surahNum, ayahNum, fetchImpl = fetch) {
  if (!Number.isInteger(surahNum) || surahNum < 1 || surahNum > 114) {
    throw new Error(`Invalid Quran Surah number: "${surahNum}"`);
  }
  if (!Number.isInteger(ayahNum) || ayahNum < 1) {
    throw new Error(`Invalid Quran Ayah number: "${ayahNum}"`);
  }

  const verseKey = `${surahNum}:${ayahNum}`;
  const verseUrl = `https://api.quran.com/api/v4/verses/by_key/${verseKey}?fields=text_uthmani&translations=20&words=true&word_fields=transliteration`;
  const options = {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  };
  const [verseResponse, chapterResponse] = await Promise.all([
    fetchImpl(verseUrl, options),
    fetchImpl(`https://api.quran.com/api/v4/chapters/${surahNum}?language=en`, options),
  ]);
  if (!verseResponse.ok) {
    throw new Error(`Quran source verification failed (${verseResponse.status}) for ${verseKey}`);
  }
  if (!chapterResponse.ok) {
    throw new Error(`Quran chapter verification failed (${chapterResponse.status}) for Surah ${surahNum}`);
  }

  const [{ verse }, { chapter }] = await Promise.all([
    verseResponse.json(),
    chapterResponse.json(),
  ]);
  const translation = verse?.translations?.find((item) => item.resource_id === 20);
  const transliteration = verse?.words
    ?.filter((word) => word.char_type_name === "word")
    .map((word) => word.transliteration?.text)
    .filter((text) => typeof text === "string" && text.trim())
    .join(" ");
  if (
    verse?.verse_key !== verseKey ||
    !verse.text_uthmani ||
    !transliteration ||
    !translation?.text ||
    chapter?.id !== surahNum ||
    !chapter.name_simple
  ) {
    throw new Error(`Quran source verification returned incomplete data for ${verseKey}`);
  }

  return {
    source: {
      type: "quran",
      surahName: chapter.name_simple,
      surahNum,
      ayahNum,
      sourceUrl: `https://quran.com/${surahNum}/${ayahNum}`,
      authenticity: "Quran",
      translationEdition: "Saheeh International",
    },
    religiousContent: {
      arabic: verse.text_uthmani,
      transliteration,
      translation: cleanTranslation(translation.text),
    },
  };
}

export async function loadIslamicContent(channelId = "islamic-reminders") {
  const file = getDbPath(channelId);
  try {
    const raw = await fs.readFile(file, "utf8");
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) throw new Error(`Invalid Islamic content database in ${file}`);
    return records;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function saveIslamicContent(channelId = "islamic-reminders", records = []) {
  const file = getDbPath(channelId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(records, null, 2) + "\n", "utf8");
}

/**
 * Validates a religious record before allowing it to transition to APPROVED.
 */
export function validateIslamicRecord(record) {
  const errors = [];
  if (!record.pillar || !ISLAMIC_PILLARS.includes(record.pillar)) {
    errors.push(`Invalid or missing pillar: "${record.pillar}"`);
  }
  if (!record.religiousContent?.arabic && !record.title) {
    errors.push("Missing religious content (arabic or title required)");
  }
  if (!record.source) {
    errors.push("Missing source attribution object");
  } else {
    if (record.source.type === "hadith") {
      if (!record.source.collection) errors.push("Hadith missing collection name");
      if (!record.source.hadithNum) errors.push("Hadith missing reference number");
      if (!record.source.authenticity) errors.push("Hadith missing authenticity grade (e.g. Sahih)");
      if (record.source.authenticity?.toLowerCase() !== "sahih" && record.source.authenticity?.toLowerCase() !== "hasan") {
        errors.push(`Hadith grade "${record.source.authenticity}" does not meet Sahih/Hasan publishing criteria`);
      }
    } else if (record.source.type === "quran") {
      if (!record.source.surahNum) errors.push("Quran verse missing Surah number");
      if (!record.source.ayahNum) errors.push("Quran verse missing Ayah number");
    }
  }

  // Audio / voiceover safety rule
  if (record.video?.voiceover === true && (record.pillar === "dua" || record.pillar === "dhikr" || record.pillar === "quran")) {
    errors.push("Voiceover / AI speech is prohibited for Dhikr, Dua, and Quran recitation");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function addIslamicRecord(channelId = "islamic-reminders", record) {
  const records = await loadIslamicContent(channelId);
  const now = new Date().toISOString();
  const newRecord = {
    id: record.id || `${record.pillar || "content"}-${Date.now().toString(36)}`,
    pillar: record.pillar || "reminder",
    format: record.format || "reminder-card",
    language: record.language || "en",
    title: record.title || "Islamic Reminder",
    religiousContent: record.religiousContent || {},
    source: record.source || {},
    verification: {
      status: record.verification?.status || "DISCOVERED",
      sourceVerified: Boolean(record.verification?.sourceVerified),
      arabicVerified: Boolean(record.verification?.arabicVerified),
      translationVerified: Boolean(record.verification?.translationVerified),
      reviewer: record.verification?.reviewer || "System",
      reviewedAt: record.verification?.reviewedAt || now,
      notes: record.verification?.notes || "",
    },
    video: {
      template: record.video?.template || "IslamicDhikrCounter",
      duration: record.video?.duration || 60,
      targetCount: record.video?.targetCount || 33,
      countType: record.video?.countType || "sunnah-suggested",
      voiceover: false,
      soundEffects: true,
      aspectRatio: "9:16",
      ...record.video,
    },
    createdAt: now,
    updatedAt: now,
  };
  records.push(newRecord);
  await saveIslamicContent(channelId, records);
  return newRecord;
}

export async function updateRecordStatus(channelId = "islamic-reminders", id, status, updates = {}) {
  const records = await loadIslamicContent(channelId);
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) {
    throw new Error(`Record ${id} not found in channel ${channelId}`);
  }

  if (status === "APPROVED") {
    const val = validateIslamicRecord({ ...records[idx], ...updates });
    if (!val.valid) {
      throw new Error(`Cannot approve record ${id}: ${val.errors.join("; ")}`);
    }
  }

  const now = new Date().toISOString();
  records[idx] = {
    ...records[idx],
    ...updates,
    verification: {
      ...records[idx].verification,
      status,
      reviewedAt: now,
      ...(updates.verification || {}),
    },
    updatedAt: now,
  };

  await saveIslamicContent(channelId, records);
  return records[idx];
}

/**
 * Finds an approved record ready to be scripted/rendered.
 */
export async function getApprovedRecord(channelId = "islamic-reminders", pillar = null) {
  const records = await loadIslamicContent(channelId);
  const filtered = records.filter((r) => {
    if (r.verification?.status !== "APPROVED") return false;
    if (pillar && r.pillar !== pillar) return false;
    return true;
  });
  return filtered[0] || null;
}

export async function getPendingUploadRecord(channelId = "islamic-reminders", pillar = null) {
  const records = await loadIslamicContent(channelId);
  return records.find((record) =>
    record.verification?.status === "UPLOAD_PENDING" &&
    !record.youtubeVideoId &&
    (!pillar || record.pillar === pillar),
  ) || null;
}
