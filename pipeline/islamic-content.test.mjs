import assert from "node:assert/strict";
import test from "node:test";
import { fetchVerifiedQuranVerse } from "./islamic-content.mjs";
import {
  buildDailyDhikrRecord,
  chooseNextIslamicRotationItem,
} from "./islamic-agent.mjs";

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

test("fetches canonical Arabic, Saheeh International translation, and Surah name", async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url.includes("/verses/by_key/20:114")) {
      return response({
        verse: {
          verse_key: "20:114",
          text_uthmani: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
          words: [
            { char_type_name: "word", transliteration: { text: "waqul" } },
            { char_type_name: "word", transliteration: { text: "rabbi" } },
            { char_type_name: "word", transliteration: { text: "zidnī" } },
            { char_type_name: "word", transliteration: { text: "ʿilmā" } },
            { char_type_name: "end", transliteration: { text: null } },
          ],
          translations: [{
            resource_id: 20,
            text: "My Lord, increase me in knowledge.<sup foot_note=1>1</sup>",
          }],
        },
      });
    }
    return response({ chapter: { id: 20, name_simple: "Taha" } });
  };

  const result = await fetchVerifiedQuranVerse(20, 114, fetchImpl);

  assert.equal(fetchCalls.length, 2);
  assert.equal(result.source.sourceUrl, "https://quran.com/20/114");
  assert.equal(result.source.surahName, "Taha");
  assert.equal(result.source.translationEdition, "Saheeh International");
  assert.equal(result.religiousContent.arabic, "وَقُل رَّبِّ زِدْنِي عِلْمًا");
  assert.equal(result.religiousContent.transliteration, "waqul rabbi zidnī ʿilmā");
  assert.equal(result.religiousContent.translation, "My Lord, increase me in knowledge.");
  assert.match(fetchCalls[0], /words=true&word_fields=transliteration/);
});

test("rejects incomplete or mismatched Quran API responses", async () => {
  const fetchImpl = async (url) => url.includes("/verses/by_key/")
    ? response({ verse: { verse_key: "20:113", text_uthmani: "text", words: [], translations: [] } })
    : response({ chapter: { id: 20, name_simple: "Taha" } });

  await assert.rejects(
    fetchVerifiedQuranVerse(20, 114, fetchImpl),
    /incomplete data for 20:114/,
  );
});

test("rejects Quran responses that omit transliteration", async () => {
  const fetchImpl = async (url) => url.includes("/verses/by_key/")
    ? response({
      verse: {
        verse_key: "20:114",
        text_uthmani: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
        translations: [{ resource_id: 20, text: "My Lord, increase me in knowledge." }],
      },
    })
    : response({ chapter: { id: 20, name_simple: "Taha" } });

  await assert.rejects(
    fetchVerifiedQuranVerse(20, 114, fetchImpl),
    /incomplete data for 20:114/,
  );
});

test("surfaces Quran API request failures instead of approving a candidate", async () => {
  const fetchImpl = async (url) => url.includes("/verses/by_key/")
    ? response({}, false, 503)
    : response({ chapter: { id: 20, name_simple: "Taha" } });

  await assert.rejects(
    fetchVerifiedQuranVerse(20, 114, fetchImpl),
    /Quran source verification failed \(503\)/,
  );
});

test("rejects invalid Quran coordinates without requesting the API", async () => {
  let called = false;
  await assert.rejects(
    fetchVerifiedQuranVerse(115, 1, async () => { called = true; }),
    /Invalid Quran Surah number/,
  );
  assert.equal(called, false);
});

test("rotates to the next Quran item and wraps at the end", () => {
  const first = chooseNextIslamicRotationItem(
    [{ sourceKey: "20:114" }],
    [],
  );
  assert.equal(first.sourceKey, "2:201");

  const nextAfterLast = chooseNextIslamicRotationItem(
    [{ sourceKey: "29:69" }],
    [],
  );
  assert.equal(nextAfterLast.sourceKey, "20:114");
});

test("skips already-used items when there is no rotation history", () => {
  const next = chooseNextIslamicRotationItem([], [
    { source: { type: "quran", surahNum: 20, ayahNum: 114 } },
  ]);
  assert.equal(next.sourceKey, "2:201");
});

test("rotates authentic Dhikr counts and sources daily", () => {
  const date = "2026-11-07";
  const rotation = Array.from({ length: 6 }, (_, index) => {
    const day = new Date(`${date}T00:00:00.000Z`);
    day.setUTCDate(day.getUTCDate() + index);
    return buildDailyDhikrRecord(day.toISOString().slice(0, 10));
  });
  const record = rotation[0];
  const nextCycle = buildDailyDhikrRecord("2026-11-13");

  assert.equal(record.id, "dhikr-20261107");
  assert.equal(record.pillar, "dhikr");
  assert.equal(record.video.template, "IslamicDhikrCounter");
  assert.equal(new Set(rotation.map((item) => item.title)).size, 6);
  assert.equal(record.video.baseDate, date);
  assert.equal(nextCycle.religiousContent.arabic, record.religiousContent.arabic);
  assert.equal(nextCycle.title, record.title);
  assert.ok(rotation.every((item) => item.video.targetCount > 0));
  assert.ok(rotation.every((item) => item.source.sourceUrl.startsWith("https://sunnah.com/")));

  const afterPrayer = rotation.filter((item) => item.source.hadithNum === "597a");
  assert.equal(afterPrayer.length, 3);
  assert.ok(afterPrayer.every((item) => item.video.targetCount === 33));

  const astaghfirullah = rotation.find((item) => item.source.hadithNum === "591");
  assert.equal(astaghfirullah.video.targetCount, 3);

  const forgiveness = rotation.find((item) => item.source.hadithNum === "6405");
  assert.equal(forgiveness.video.targetCount, 100);
  assert.equal(forgiveness.video.rewardAnimation, "foam-forgiveness");
  assert.match(forgiveness.video.rewardCaption, /foam of the sea/);

  const deeds = rotation.find((item) => item.source.hadithNum === "3293");
  assert.equal(deeds.video.targetCount, 100);
  assert.equal(deeds.video.rewardAnimation, "deeds-and-erasure");
  assert.match(deeds.video.rewardCaption, /100 good deeds.*100 sins erased/);
});

test("rejects malformed dates for daily Dhikr records", () => {
  assert.throws(
    () => buildDailyDhikrRecord("not-a-date"),
    /Invalid Islamic publishing date/,
  );
  assert.throws(
    () => buildDailyDhikrRecord("2026-02-30"),
    /Invalid Islamic publishing date/,
  );
});
