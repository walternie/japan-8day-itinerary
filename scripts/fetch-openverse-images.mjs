import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { days } from "../data/itinerary.js";

const API_URL = "https://api.openverse.org/v1/images/";
const USER_AGENT = "JP2609 itinerary/1.0 (walternie@163.com)";
const PAGE_SIZE = "50";
const DOWNLOAD_CONCURRENCY = 7;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const RETRIES = 2;
const ALLOWED_LICENSES = new Set(["cc0", "pdm", "by", "by-sa"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageDirectory = resolve(root, "assets", "images");
const creditsPath = resolve(root, "data", "image-credits.js");
const failuresPath = resolve(root, "data", "image-fetch-failures.json");

const QUERIES_BY_DAY = {
  D1: [
    "Beijing Capital airport",
    "ANA aircraft Japan",
    "Tokyo Haneda airport",
    "Keikyu train Yokohama",
    "Yokohama city street",
    "Japanese convenience store food",
  ],
  D2: [
    "Mount Fuji landscape",
    "Lake Kawaguchiko",
    "Kawaguchiko railway station",
    "Japan sightseeing bus",
    "Japanese ropeway cable car",
    "Japanese noodles restaurant",
  ],
  D3: [
    "Haneda airport aircraft",
    "Osaka Umeda city",
    "Japanese railway train",
    "Kyoto railway station",
    "Kyoto market streets",
    "Kyoto traditional alley",
  ],
  D4: [
    "Kyoto temple architecture",
    "Nanzenji Kyoto",
    "Kyoto Higashiyama streets",
    "Kiyomizu dera Kyoto",
    "Gion Kyoto street",
    "Kamo River Kyoto",
  ],
  D5: [
    "Fushimi Inari Kyoto",
    "Uji Kyoto river",
    "Byodoin Uji",
    "Japanese local train",
    "Nintendo museum exterior Uji",
    "Japanese matcha tea food",
  ],
  D6: [
    "Kyoto railway station",
    "Japanese limited express train",
    "Kuroshio train Japan",
    "Shirahama Wakayama coast",
    "Shirahama beach Japan",
    "Japanese onsen food",
  ],
  D7: [
    "Kumano Kodo trail",
    "Daimonzaka stone path",
    "Kumano Nachi shrine",
    "Nachi waterfall Japan",
    "Kii Katsuura Wakayama",
    "Japanese coastal train",
  ],
  D8: [
    "Shirahama railway station",
    "Kuroshio train Wakayama",
    "Kansai airport train",
    "Kansai International Airport",
    "ANA aircraft Kansai airport",
    "Japanese railway bento",
  ],
};

const HINT_RULES = [
  [/机场|羽田|伊丹|关西|值机|安检|登机|入境|行李/u, "airport terminal aircraft travel"],
  [/NH\d+|飞行/u, "ANA aircraft airplane airport"],
  [/车|站|铁路|JR|京急|黑潮|巴士|换乘|候车/u, "train railway station bus transport"],
  [/早餐|午餐|晚餐|便当|补给|鳗鱼|和牛|抹茶/u, "Japanese food restaurant meal"],
  [/富士|河口湖|大石/u, "Mount Fuji Kawaguchiko lake landscape"],
  [/缆车/u, "ropeway cable car mountain"],
  [/游览船|湖畔|船津浜/u, "lake boat waterfront"],
  [/南禅寺|知恩院|清水寺|平等院/u, "Kyoto temple architecture"],
  [/祇园|花见|二年坂|三年坂|东山|哲学/u, "Kyoto traditional street"],
  [/伏见|稻荷/u, "Fushimi Inari torii shrine"],
  [/宇治|小仓/u, "Uji Kyoto river tea"],
  [/Nintendo/u, "Nintendo museum Uji exterior"],
  [/三段壁|千畳敷|白良滨|白滨/u, "Shirahama Wakayama coast beach"],
  [/大门坂|熊野/u, "Kumano Kodo Daimonzaka trail shrine"],
  [/那智/u, "Nachi waterfall shrine Wakayama"],
  [/温泉/u, "Japanese onsen hot spring"],
];

const steps = days.flatMap((day) =>
  day.steps.map((step) => ({ ...step, dayId: day.id })),
);

if (steps.length !== 101) throw new Error(`Expected 101 steps, found ${steps.length}`);
for (const day of days) {
  const queryCount = QUERIES_BY_DAY[day.id]?.length ?? 0;
  if (queryCount < 3 || queryCount > 6) {
    throw new Error(`${day.id} must have 3-6 Openverse queries`);
  }
}

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function cleanText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function normalizeLicense(value) {
  return cleanText(value).toLowerCase().replace(/^cc-/u, "");
}

function contentWords(candidate) {
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.map((tag) => tag?.name ?? tag).join(" ")
    : "";
  return `${candidate.title ?? ""} ${tags}`.toLowerCase();
}

function stepHints(step) {
  const matched = HINT_RULES.filter(([pattern]) => pattern.test(step.title))
    .map(([, hints]) => hints)
    .join(" ");
  return matched || QUERIES_BY_DAY[step.dayId].join(" ");
}

function candidateScore(step, candidate) {
  const haystack = contentWords(candidate);
  const terms = [...new Set(stepHints(step).toLowerCase().match(/[a-z]{3,}/gu) ?? [])];
  const keywordScore = terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 8 : 0),
    0,
  );
  const typeScore = /^(?:jpg|jpeg)$/iu.test(candidate.filetype ?? "") ? 10 : 0;
  const landscapeScore =
    Number(candidate.width) > Number(candidate.height) && Number(candidate.height) > 0
      ? 6
      : 0;
  const licenseScore = { cc0: 5, pdm: 5, by: 4, "by-sa": 3 }[
    normalizeLicense(candidate.license)
  ] ?? 0;
  return keywordScore + typeScore + landscapeScore + licenseScore;
}

function toCandidate(result) {
  const title = cleanText(result.title);
  const creator = cleanText(result.creator);
  const license = normalizeLicense(result.license);
  const licenseUrl = cleanText(result.license_url);
  const sourceUrl = cleanText(result.foreign_landing_url);
  const url = cleanText(result.url);
  const thumbnail = cleanText(result.thumbnail);
  const filetype = cleanText(result.filetype);
  if (
    !result.id ||
    !title ||
    !creator ||
    !ALLOWED_LICENSES.has(license) ||
    !/^https?:\/\//iu.test(licenseUrl) ||
    !/^https?:\/\//iu.test(sourceUrl) ||
    !/^https?:\/\//iu.test(url) ||
    (!thumbnail && !url) ||
    /svg/iu.test(filetype)
  ) {
    return null;
  }
  return {
    id: result.id,
    title,
    creator,
    license,
    licenseUrl,
    sourceUrl,
    url,
    thumbnail,
    filetype,
    width: result.width,
    height: result.height,
    tags: result.tags,
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, retries = RETRIES) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        url,
        {
          ...options,
          headers: {
            "User-Agent": USER_AGENT,
            ...options.headers,
          },
        },
        DOWNLOAD_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

async function searchOpenverse(query) {
  const parameters = new URLSearchParams({ q: query, page_size: PAGE_SIZE });
  const response = await fetchWithRetry(`${API_URL}?${parameters}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json();
  return Array.isArray(payload.results) ? payload.results : [];
}

async function buildDayPool(dayId) {
  const queryResults = await Promise.all(
    QUERIES_BY_DAY[dayId].map(async (query) => {
      try {
        const results = await searchOpenverse(query);
        console.log(`${dayId} search "${query}": ${results.length}`);
        return results;
      } catch (error) {
        console.warn(`${dayId} search "${query}" failed: ${error.message}`);
        return [];
      }
    }),
  );
  const unique = new Map();
  for (const result of queryResults.flat()) {
    const candidate = toCandidate(result);
    if (candidate && !unique.has(candidate.sourceUrl)) {
      unique.set(candidate.sourceUrl, candidate);
    }
  }
  console.log(`${dayId} usable unique pool: ${unique.size}`);
  return [...unique.values()];
}

function detectedImageType(bytes, headerType) {
  const type = cleanText(headerType).split(";")[0].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

async function fetchImageBytes(candidate) {
  const urls = [...new Set([candidate.thumbnail, candidate.url].filter(Boolean))];
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetchWithRetry(url, {
        headers: { Accept: "image/jpeg,image/png,image/webp" },
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const imageType = detectedImageType(bytes, response.headers.get("content-type"));
      if (!imageType || bytes.length === 0) {
        throw new Error(
          `unsupported image response (${response.headers.get("content-type") ?? "none"})`,
        );
      }
      return { bytes, imageType };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No download URL");
}

async function writeImageAtomically(destination, bytes) {
  const temporaryPath = `${destination}.${process.pid}.${Date.now()}.part`;
  try {
    await writeFile(temporaryPath, bytes);
    await rm(destination, { force: true });
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function isCompleteCredit(credit) {
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
  ].every((field) => cleanText(credit?.[field]));
}

async function readExistingCredits() {
  try {
    await access(creditsPath);
    const moduleUrl = `${pathToFileURL(creditsPath).href}?resume=${Date.now()}`;
    const { imageCredits } = await import(moduleUrl);
    return Array.isArray(imageCredits) ? imageCredits : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function writeState(credits, failures) {
  const byStep = new Map(credits.map((credit) => [credit.stepId, credit]));
  const ordered = steps.map(({ id }) => byStep.get(id)).filter(Boolean);
  const source =
    "// Generated from Openverse API metadata by scripts/fetch-openverse-images.mjs.\n" +
    `export const imageCredits = ${JSON.stringify(ordered, null, 2)};\n`;
  await Promise.all([
    writeFile(creditsPath, source, "utf8"),
    writeFile(failuresPath, `${JSON.stringify(failures, null, 2)}\n`, "utf8"),
  ]);
}

async function cleanTemporaryFiles() {
  await mkdir(imageDirectory, { recursive: true });
  const names = await readdir(imageDirectory);
  await Promise.all(
    names
      .filter((name) => name.endsWith(".part"))
      .map((name) => rm(resolve(imageDirectory, name), { force: true })),
  );
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

async function main() {
  await cleanTemporaryFiles();
  const existingCredits = await readExistingCredits();
  const credits = [];
  const failures = [];
  const usedSources = new Set();
  const usedOriginalUrls = new Set();
  const usedHashes = new Set();
  let persistQueue = Promise.resolve();

  for (const step of steps) {
    const credit = existingCredits.find(({ stepId }) => stepId === step.id);
    const destination = resolve(imageDirectory, `${step.id}.jpg`);
    if (!credit || !isCompleteCredit(credit)) continue;
    try {
      const fileStat = await stat(destination);
      const hash = await sha256File(destination);
      if (
        fileStat.size > 0 &&
        hash === credit.sha256 &&
        !usedHashes.has(hash) &&
        !usedSources.has(credit.sourceUrl)
      ) {
        credits.push(credit);
        usedHashes.add(hash);
        usedSources.add(credit.sourceUrl);
        if (credit.originalUrl) usedOriginalUrls.add(credit.originalUrl);
        console.log(`skip ${step.id} ${step.title}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`resume ${step.id}: ${error.message}`);
    }
  }

  for (const day of days) {
    const pending = day.steps
      .map((step) => ({ ...step, dayId: day.id }))
      .filter((step) => !credits.some(({ stepId }) => stepId === step.id));
    if (!pending.length) continue;

    const dayPool = await buildDayPool(day.id);
    await runPool(
      pending,
      async (step) => {
        const destination = resolve(imageDirectory, `${step.id}.jpg`);
        const ranked = [...dayPool].sort(
          (left, right) =>
            candidateScore(step, right) - candidateScore(step, left),
        );
        let selected;
        let lastError;

        for (const candidate of ranked) {
          if (
            usedSources.has(candidate.sourceUrl) ||
            usedOriginalUrls.has(candidate.url)
          ) {
            continue;
          }
          usedSources.add(candidate.sourceUrl);
          usedOriginalUrls.add(candidate.url);
          try {
            const { bytes, imageType } = await fetchImageBytes(candidate);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            if (usedHashes.has(sha256)) continue;
            usedHashes.add(sha256);
            await writeImageAtomically(destination, bytes);
            selected = {
              stepId: step.id,
              localFile: `assets/images/${step.id}.jpg`,
              title: candidate.title,
              creator: candidate.creator,
              license: candidate.license,
              licenseUrl: candidate.licenseUrl,
              sourceUrl: candidate.sourceUrl,
              retrievedAt: new Date().toISOString().slice(0, 10),
              originalUrl: candidate.url,
              imageType,
              sha256,
            };
            break;
          } catch (error) {
            lastError = error;
          }
        }

        if (selected) {
          credits.push(selected);
          console.log(`[${credits.length}/${steps.length}] ${step.id} ${step.title}`);
        } else {
          failures.push({
            stepId: step.id,
            title: step.title,
            dayId: day.id,
            error: lastError?.message ?? "No unused candidate remained",
            failedAt: new Date().toISOString(),
          });
          console.error(`FAILED ${step.id}: ${failures.at(-1).error}`);
        }
        persistQueue = persistQueue.then(() => writeState(credits, failures));
        await persistQueue;
      },
      DOWNLOAD_CONCURRENCY,
    );
  }

  await persistQueue;
  await writeState(credits, failures);
  const counts = Object.fromEntries(
    days.map((day) => [
      day.id,
      credits.filter(({ stepId }) => stepId.startsWith(day.id.toLowerCase())).length,
    ]),
  );
  console.log(`Completed: ${credits.length} downloaded, ${failures.length} failed`);
  console.log(`By day: ${JSON.stringify(counts)}`);
  if (credits.length !== steps.length || failures.length) process.exitCode = 1;
}

await main();
