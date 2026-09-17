import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { days } from "../data/itinerary.js";
import { getStepImageFilename } from "../lib/site.js";

const USER_AGENT = "JP2609 itinerary/1.0 (walternie@163.com)";
const WIDTH = 960;
const HEIGHT = 540;
const CONCURRENCY = 8;
const TIMEOUT_MS = 15_000;
const RETRIES = 2;
const MAX_ATTEMPTS_PER_STEP = 24;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageDirectory = resolve(root, "assets", "images");
const creditsPath = resolve(root, "data", "image-credits.js");
const failuresPath = resolve(root, "data", "image-fetch-failures.json");

const LICENSES = {
  cc: {
    name: "CC BY 2.0",
    url: "https://creativecommons.org/licenses/by/2.0/",
  },
  "cc-sa": {
    name: "CC BY-SA 2.0",
    url: "https://creativecommons.org/licenses/by-sa/2.0/",
  },
  cc0: {
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  pd: {
    name: "Public Domain Mark 1.0",
    url: "https://creativecommons.org/publicdomain/mark/1.0/",
  },
};

const DAY_TAGS = {
  D1: ["beijing,airport", "airplane,airport", "haneda,airport", "yokohama,japan"],
  D2: ["mountfuji,japan", "kawaguchiko,japan", "lake,mountfuji", "japan,ropeway"],
  D3: ["osaka,japan", "kyoto,japan", "japan,train", "kyoto,street"],
  D4: ["kyoto,temple", "gion,kyoto", "kiyomizu,kyoto", "kyoto,street"],
  D5: ["fushimiinari,kyoto", "uji,japan", "byodoin,japan", "japan,museum"],
  D6: ["kyoto,japan", "japan,train", "shirahama,japan", "wakayama,coast"],
  D7: ["kumano,japan", "nachi,japan", "japan,waterfall", "japan,trail"],
  D8: ["shirahama,japan", "kansai,airport", "japan,train", "airplane,japan"],
};

const STEP_TAG_RULES = [
  [/NH\d+|航班|飞行/u, "airplane,airport"],
  [/机场|羽田|伊丹|关西|值机|安检|登机|入境/u, "airport,terminal"],
  [/早餐|午餐|晚餐|便当|补给|鳗鱼|和牛|抹茶|海鲜/u, "japanese,food"],
  [/黑潮|JR|京急|铁路|列车|车站|换乘/u, "japan,train"],
  [/巴士|公交/u, "japan,bus"],
  [/富士|河口湖|大石/u, "mountfuji,kawaguchiko"],
  [/缆车/u, "japan,ropeway"],
  [/游览船|湖畔|船津浜/u, "japan,lake"],
  [/Mont-bell|购物|市场/u, "japan,shopping"],
  [/南禅寺|知恩院|清水寺|平等院|寺/u, "kyoto,temple"],
  [/祇园|花见|二年坂|三年坂|东山|哲学/u, "kyoto,street"],
  [/伏见|稻荷/u, "fushimiinari,kyoto"],
  [/宇治|小仓/u, "uji,japan"],
  [/Nintendo|博物馆/u, "japan,museum"],
  [/三段壁|千畳敷|白良滨|白滨/u, "shirahama,japan"],
  [/大门坂|熊野/u, "kumano,japan"],
  [/那智/u, "nachi,japan"],
  [/温泉/u, "japan,onsen"],
];

const steps = days.flatMap((day) =>
  day.steps.map((step, index) => ({ ...step, dayId: day.id, dayIndex: index })),
);

if (steps.length !== 105) {
  throw new Error(`Expected 105 steps, found ${steps.length}`);
}

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function clean(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function tagsForStep(step, attempt) {
  const specific = STEP_TAG_RULES.find(([pattern]) => pattern.test(step.title))?.[1];
  const dayTags = DAY_TAGS[step.dayId];
  if (specific && attempt < 12) return specific;
  return dayTags[(step.dayIndex + attempt) % dayTags.length];
}

function seedFor(step, attempt) {
  const digest = createHash("sha256")
    .update(`${step.id}:${attempt}`)
    .digest()
    .readUInt32BE(0);
  return (digest % 2_000_000_000) + 1;
}

function photoIdFromUrl(url) {
  const match = clean(url).match(/\/(\d+)_([a-f0-9]+)(?:_[a-z])?\.jpe?g(?:$|\?)/iu);
  return match?.[1] ?? "";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      headers: { "User-Agent": USER_AGENT, ...options.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(350 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function getCandidate(step, attempt) {
  const tags = tagsForStep(step, attempt);
  const lock = seedFor(step, attempt);
  const endpoint =
    `https://loremflickr.com/json/${WIDTH}/${HEIGHT}/` +
    `${encodeURIComponent(tags)}?lock=${lock}`;
  const response = await fetchWithRetry(endpoint, {
    headers: { Accept: "application/json" },
  });
  const data = await response.json();
  const license = LICENSES[clean(data.license).toLowerCase()];
  const fileUrl = clean(data.file);
  const rawFileUrl = clean(data.rawFileUrl);
  const creator = clean(data.owner);
  const photoId = photoIdFromUrl(rawFileUrl || fileUrl);

  if (!license || !creator || !photoId || !/^https:\/\//u.test(fileUrl)) return null;

  return {
    creator,
    license,
    fileUrl,
    rawFileUrl,
    photoId,
    tags: clean(data.tags || tags),
  };
}

async function downloadJpeg(url) {
  const response = await fetchWithRetry(url, {
    headers: { Accept: "image/jpeg" },
  });
  const contentType = clean(response.headers.get("content-type")).toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    !contentType.startsWith("image/jpeg") ||
    bytes.length < 5_000 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  ) {
    throw new Error(`Invalid JPEG response (${contentType}, ${bytes.length} bytes)`);
  }
  return bytes;
}

async function writeAtomically(destination, bytes) {
  const temporary = `${destination}.${process.pid}.${Date.now()}.part`;
  try {
    await writeFile(temporary, bytes);
    await rm(destination, { force: true });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function completeCredit(credit) {
  return [
    "stepId",
    "localFile",
    "title",
    "creator",
    "license",
    "licenseUrl",
    "sourceUrl",
    "retrievedAt",
    "sha256",
    "photoId",
  ].every((field) => clean(credit?.[field]));
}

async function readCredits() {
  try {
    const url = `${pathToFileURL(creditsPath).href}?v=${Date.now()}`;
    const { imageCredits } = await import(url);
    return Array.isArray(imageCredits) ? imageCredits : [];
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND") return [];
    throw error;
  }
}

async function fileHash(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeState(credits, failures) {
  const byStep = new Map(credits.map((credit) => [credit.stepId, credit]));
  const ordered = steps.map((step) => byStep.get(step.id)).filter(Boolean);
  const source =
    "// Generated from Flickr Creative Commons metadata returned by LoremFlickr.\n" +
    `export const imageCredits = ${JSON.stringify(ordered, null, 2)};\n`;
  await Promise.all([
    writeFile(creditsPath, source, "utf8"),
    writeFile(failuresPath, `${JSON.stringify(failures, null, 2)}\n`, "utf8"),
  ]);
}

async function runPool(items, worker) {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

async function main() {
  await mkdir(imageDirectory, { recursive: true });

  const existing = await readCredits();
  const credits = [];
  const failures = [];
  const usedPhotoIds = new Set();
  const usedHashes = new Set();

  for (const step of steps) {
    const credit = existing.find(({ stepId }) => stepId === step.id);
    const destination = resolve(imageDirectory, getStepImageFilename(step));
    if (!completeCredit(credit)) continue;
    try {
      const info = await stat(destination);
      const hash = await fileHash(destination);
      if (
        info.size > 0 &&
        hash === credit.sha256 &&
        !usedPhotoIds.has(credit.photoId) &&
        !usedHashes.has(hash)
      ) {
        credits.push(credit);
        usedPhotoIds.add(credit.photoId);
        usedHashes.add(hash);
      }
    } catch {
      // Incomplete resume entry; download it again.
    }
  }

  let completedSinceWrite = 0;
  let writeQueue = Promise.resolve();
  const pending = steps.filter(
    (step) => !credits.some(({ stepId }) => stepId === step.id),
  );

  await runPool(pending, async (step) => {
    const filename = getStepImageFilename(step);
    const destination = resolve(imageDirectory, filename);
    let selected;
    let lastError;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_STEP; attempt += 1) {
      try {
        const candidate = await getCandidate(step, attempt);
        if (!candidate || usedPhotoIds.has(candidate.photoId)) continue;
        const bytes = await downloadJpeg(candidate.fileUrl);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (usedHashes.has(sha256)) continue;

        usedPhotoIds.add(candidate.photoId);
        usedHashes.add(sha256);
        await writeAtomically(destination, bytes);
        selected = {
          stepId: step.id,
          localFile: `assets/images/${filename}`,
          title: `Flickr #${candidate.photoId} — ${step.title}`,
          creator: candidate.creator,
          license: candidate.license.name,
          licenseUrl: candidate.license.url,
          sourceUrl: `https://www.flickr.com/photo.gne?id=${candidate.photoId}`,
          retrievedAt: new Date().toISOString().slice(0, 10),
          photoId: candidate.photoId,
          tags: candidate.tags,
          originalUrl: candidate.rawFileUrl,
          sha256,
        };
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (selected) {
      credits.push(selected);
      completedSinceWrite += 1;
      console.log(`[${credits.length}/${steps.length}] ${step.id} ${step.title}`);
    } else {
      failures.push({
        stepId: step.id,
        title: step.title,
        error: lastError?.message ?? "No acceptable unique CC image found",
      });
      console.error(`FAILED ${step.id}: ${failures.at(-1).error}`);
    }

    if (completedSinceWrite >= 10 || failures.length) {
      completedSinceWrite = 0;
      writeQueue = writeQueue.then(() => writeState(credits, failures));
      await writeQueue;
    }
  });

  await writeQueue;
  await writeState(credits, failures);

  const counts = Object.fromEntries(
    days.map((day) => [
      day.id,
      credits.filter(({ stepId }) => stepId.startsWith(day.id.toLowerCase())).length,
    ]),
  );
  console.log(`Completed: ${credits.length}/${steps.length}; failures: ${failures.length}`);
  console.log(`By day: ${JSON.stringify(counts)}`);
  if (credits.length !== steps.length || failures.length) process.exitCode = 1;
}

await main();
