import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";

import { days } from "../data/itinerary.js";
import { getStepImageFilename, getStepImagePath } from "../lib/site.js";

const rootUrl = new URL("../", import.meta.url);
const steps = days.flatMap(({ steps: daySteps }) => daySteps);
const expectedFiles = steps.map(getStepImageFilename).sort();

test("stores exactly one local image file for every itinerary step", async () => {
  const imageDirectory = new URL("../assets/images/", import.meta.url);
  const actualFiles = (await readdir(imageDirectory)).sort();

  assert.equal(steps.length, 105);
  assert.deepEqual(actualFiles, expectedFiles);
  await Promise.all(
    steps.map(async (step) => {
      const imageUrl = new URL(getStepImagePath(step), rootUrl);
      await access(imageUrl);
      assert.ok((await readFile(imageUrl)).byteLength > 0, `${step.id} is empty`);
      assert.match(getStepImageFilename(step), /\.(?:png|jpe?g|webp|gif)$/iu);
    }),
  );
});

test("step images remain non-empty after local sync", async () => {
  const hashes = await Promise.all(
    steps.map(async (step) => {
      const bytes = await readFile(new URL(getStepImagePath(step), rootUrl));
      assert.ok(bytes.byteLength > 0, `${step.id} is empty`);
      return createHash("sha256").update(bytes).digest("hex");
    }),
  );

  // User-provided PNG/JPEG replacements may intentionally reuse the same photo.
  assert.ok(new Set(hashes).size >= 90, "too many identical placeholder images");
});

test("exports one complete Flickr credit per step", async () => {
  const creditsPath = new URL("../data/image-credits.js", import.meta.url);
  await access(creditsPath);
  const { imageCredits } = await import(creditsPath.href);

  assert.equal(imageCredits.length, 105);
  assert.deepEqual(
    imageCredits.map(({ stepId }) => stepId).sort(),
    steps.map(({ id }) => id).sort(),
  );

  const requiredFields = [
    "stepId",
    "localFile",
    "title",
    "creator",
    "license",
    "licenseUrl",
    "sourceUrl",
    "retrievedAt",
  ];
  for (const credit of imageCredits) {
    for (const field of requiredFields) {
      assert.equal(typeof credit[field], "string", `${credit.stepId}: ${field}`);
      assert.ok(credit[field].trim(), `${credit.stepId}: ${field}`);
    }
    const step = steps.find(({ id }) => id === credit.stepId);
    assert.equal(credit.localFile, `assets/images/${getStepImageFilename(step)}`);
    assert.match(credit.licenseUrl, /^https?:\/\//);
    assert.match(credit.sourceUrl, /^https?:\/\//);
    assert.match(credit.retrievedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("credits page dynamically renders escaped Flickr attribution data", async () => {
  const html = await readFile(new URL("../credits.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../credits.js", import.meta.url), "utf8");

  assert.match(html, /<script type="module" src="credits\.js"><\/script>/);
  assert.match(html, /Flickr/u);
  assert.match(script, /imageCredits/);
  assert.match(script, /escapeHtml/);
  assert.match(script, /rel="noopener"/);
  assert.match(script, /credit\.sourceUrl/);
  assert.match(script, /credit\.licenseUrl/);
});
