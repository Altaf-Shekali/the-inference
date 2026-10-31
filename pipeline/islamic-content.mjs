/**
 * Islamic Content and Source Verification Database Manager.
 *
 * Manages the structured content database for the Islamic Reminders channel,
 * enforcing verification lifecycles, authentic references, and preventing
 * unverified or fabricated religious content from ever reaching render/publish.
 *
 * Lifecycle:
 * DISCOVERED -> SOURCED -> DRAFTED -> VERIFICATION_PENDING -> APPROVED -> RENDERED -> PUBLISHED
 *                                                          \-> REJECTED
 */
import { promises as fs, existsSync } from "fs";
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
  "PUBLISHED",
];

function getDbPath(channelId = "islamic-reminders") {
  return path.join(DIR, "channels", channelId, "content-db.json");
}

export async function loadIslamicContent(channelId = "islamic-reminders") {
  const file = getDbPath(channelId);
  if (!existsSync(file)) {
    return [];
  }
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error loading Islamic content database from ${file}:`, err);
    return [];
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
