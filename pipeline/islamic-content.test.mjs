import assert from "node:assert/strict";
import test from "node:test";
import { fetchVerifiedQuranVerse } from "./islamic-content.mjs";
import { chooseNextIslamicRotationItem } from "./islamic-agent.mjs";

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
  assert.equal(result.religiousContent.translation, "My Lord, increase me in knowledge.");
});

test("rejects incomplete or mismatched Quran API responses", async () => {
  const fetchImpl = async (url) => url.includes("/verses/by_key/")
    ? response({ verse: { verse_key: "20:113", text_uthmani: "text", translations: [] } })
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
