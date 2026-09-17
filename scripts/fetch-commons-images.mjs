import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { days } from "../data/itinerary.js";

const USER_AGENT =
  "JP2609TravelImageFetcher/1.0 (personal itinerary; contact: walternie@163.com)";
const API_URL = "https://commons.wikimedia.org/w/api.php";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageDirectory = resolve(root, "assets", "images");
const creditsPath = resolve(root, "data", "image-credits.js");
const failuresPath = resolve(root, "data", "image-fetch-failures.json");
const creditsHtmlPath = resolve(root, "credits.html");

// Every query is deliberately English and/or Japanese so Commons search does
// not depend on Chinese-only itinerary labels. Array order matches itinerary.js.
const SEARCHES_BY_DAY = {
  D1: [
    "Beijing Capital International Airport Terminal 3 exterior",
    "All Nippon Airways Boeing 787 Haneda ANA",
    "Tokyo Haneda Airport Terminal 3 arrivals",
    "Keikyu train Yokohama 京急電鉄",
    "Yokohama Station west exit street night",
    "Japanese convenience store bento コンビニ",
  ],
  D2: [
    "Japanese hotel breakfast 和朝食",
    "Yokohama Station west bus terminal",
    "Fujikyu highway bus Kawaguchiko",
    "Kawaguchiko sightseeing bus red line",
    "Oishi Park Lake Kawaguchi 大石公園",
    "Lake Kawaguchi ropeway entrance",
    "Mt Fuji Panoramic Ropeway 富士山パノラマロープウェイ",
    "Lake Kawaguchi sightseeing boat 河口湖遊覧船",
    "Hoto noodles Kawaguchiko ほうとう",
    "Funatsuhama Lake Kawaguchi promenade",
    "Kawaguchiko Station railway building",
    "Kawaguchiko Station platform 富士急行",
    "Fujiyoshida local bus Mount Fuji",
    "Roadside Station Fujiyoshida 道の駅富士吉田",
    "Fujikyu bus at Kawaguchiko Station",
    "Kawaguchiko bus terminal passengers",
    "Lake Liner highway bus Yokohama",
    "Yokohama Japanese set meal 定食",
  ],
  D3: [
    "Japanese business hotel breakfast buffet",
    "Haneda Airport Terminal 2 departure",
    "Japan airport security checkpoint",
    "ANA aircraft Tokyo Haneda Osaka Itami",
    "Osaka Itami Airport limousine bus",
    "Grand Front Osaka south building",
    "Montbell store Japan outdoor clothing",
    "Umeda Osaka udon restaurant",
    "JR Kyoto Line Special Rapid train",
    "Miyako Hotel Kyoto Hachijo exterior",
    "Higashi Honganji Kyoto 東本願寺",
    "Kyoto Station Hachijo exit",
    "Kyoto subway Karasuma Line train",
    "Nishiki Market Kyoto 錦市場",
    "Teramachi shopping street Kyoto",
    "Unagi rice Kyoto うな重",
    "Pontocho alley Kyoto night 先斗町",
    "Kyoto Station night architecture",
  ],
  D4: [
    "Kyoto traditional Japanese breakfast",
    "Keage Station Kyoto subway 蹴上駅",
    "Nanzenji aqueduct Kyoto 南禅寺水路閣",
    "Philosopher's Path Kyoto 哲学の道",
    "Higashiyama Kyoto pedestrian street",
    "Chion-in Sanmon Kyoto 知恩院",
    "Yasaka Shrine Kyoto 八坂神社",
    "Ninenzaka Sannenzaka Kyoto 二年坂",
    "Kyoto matcha dessert 抹茶",
    "Kiyomizuzaka slope Kyoto",
    "Kiyomizudera main hall Kyoto 清水寺",
    "Yasaka Pagoda sunset Kyoto 八坂の塔",
    "Japanese wagyu steak 和牛",
    "Hanamikoji Gion Kyoto 花見小路",
    "Kamo River Kyoto evening 鴨川",
  ],
  D5: [
    "Kyoto Station breakfast restaurant",
    "JR Inari Station Kyoto 稲荷駅",
    "Fushimi Inari torii Kyoto 伏見稲荷",
    "JR Nara Line train Kyoto Uji",
    "Byodoin Phoenix Hall Uji 平等院鳳凰堂",
    "Uji Bridge and Uji River 宇治橋",
    "Byodoin Omotesando Uji tea shops",
    "Uji matcha soba noodles 茶そば",
    "JR Ogura Station Kyoto 小倉駅",
    "Ogura Uji Kyoto streetscape",
    "Nintendo Museum Uji 任天堂ミュージアム",
    "Kyoto JR Nara Line evening train",
  ],
  D6: [
    "Japanese hotel luggage storage",
    "Kyoto hotel reception checkout",
    "AEON Mall Kyoto exterior",
    "Montbell Kyoto outdoor shop",
    "Japanese rolling luggage hotel",
    "JR Kyoto Line Kyoto Shin Osaka train",
    "Shin Osaka Station railway platform",
    "Kuroshio limited express train くろしお",
    "Shirahama Station Wakayama 白浜駅",
    "Sandanbeki cliffs Wakayama 三段壁",
    "Senjojiki Shirahama Wakayama 千畳敷",
    "Shirarahama beach sunset 白良浜",
    "Wakayama grilled fish Japanese dinner",
    "Shirahama onsen outdoor bath 温泉",
  ],
  D7: [
    "Japanese hiking breakfast onigiri",
    "Shirahama Station taxi Wakayama",
    "Kii Katsuura railway station train",
    "Kumano bus Wakayama 熊野御坊南海バス",
    "Daimonzaka bus stop Nachikatsuura",
    "Daimonzaka stone path Kumano Kodo 大門坂",
    "Kumano Nachi Taisha Seigantoji pagoda",
    "Nachi Falls Wakayama 那智の滝",
    "Kii Katsuura port town Wakayama",
    "Katsuura tuna cooked dish Wakayama",
    "Kii Katsuura Station platform",
    "Kuroshio train Wakayama coast",
    "Japanese onsen stretching relaxation",
  ],
  D8: [
    "Japanese travel luggage packing hotel",
    "Japanese hotel checkout lobby",
    "Shirahama railway station exterior",
    "Japanese railway station kiosk bento",
    "Limited Express Kuroshio Hineno",
    "Kansai Airport Rapid train 関空快速",
    "Kansai International Airport Terminal 1 check in",
    "Kansai Airport international departure gate",
    "ANA aircraft Kansai International Airport",
  ],
};

const steps = days.flatMap((day) =>
  day.steps.map((step, index) => ({
    ...step,
    dayId: day.id,
    dayTitle: day.title,
    searchQuery: SEARCHES_BY_DAY[day.id]?.[index],
  })),
);

for (const day of days) {
  if (SEARCHES_BY_DAY[day.id]?.length !== day.steps.length) {
    throw new Error(
      `${day.id} has ${day.steps.length} steps but ${SEARCHES_BY_DAY[day.id]?.length ?? 0} image queries`,
    );
  }
}
if (steps.some(({ searchQuery }) => !searchQuery)) {
  throw new Error("Every itinerary step must have an English/Japanese search query");
}

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: options.accept ?? "*/*",
          ...options.headers,
        },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`  retry ${attempt}/${attempts - 1}: ${error.message}`);
        await delay(750 * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/giu, (_, number) =>
      String.fromCodePoint(Number.parseInt(number, 16)),
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function isCompleteCredit(credit) {
  return [
    "stepId",
    "localFile",
    "commonsTitle",
    "author",
    "license",
    "licenseUrl",
    "sourceUrl",
    "retrievedAt",
    "commonsSha1",
    "sha256",
  ].every((field) => typeof credit?.[field] === "string" && credit[field].trim());
}

async function searchCommons(searchQuery) {
  const parameters = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: searchQuery,
    gsrnamespace: "6",
    gsrlimit: "50",
    prop: "imageinfo",
    iiprop: "url|sha1|mime|mediatype|extmetadata",
    iiurlwidth: "960",
    iiextmetadatalanguage: "en",
    origin: "*",
  });
  const response = await fetchWithRetry(`${API_URL}?${parameters}`, {
    accept: "application/json",
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.info ?? payload.error.code);
  return payload.query?.pages ?? [];
}

function candidateCredit(page) {
  const info = page.imageinfo?.[0];
  const metadata = info?.extmetadata ?? {};
  const author = stripHtml(metadata.Artist?.value);
  const license = stripHtml(metadata.LicenseShortName?.value);
  const licenseUrl = String(metadata.LicenseUrl?.value ?? "").trim();
  const sourceUrl = String(info?.descriptionurl ?? "").trim();
  const downloadUrl = info?.thumburl || info?.url;

  if (
    info?.mime !== "image/jpeg" ||
    info?.mediatype !== "BITMAP" ||
    !info.sha1 ||
    !downloadUrl ||
    !author ||
    !license ||
    !licenseUrl ||
    !sourceUrl
  ) {
    return null;
  }
  return {
    commonsTitle: page.title,
    author,
    license,
    licenseUrl,
    sourceUrl,
    commonsSha1: info.sha1,
    downloadUrl,
  };
}

async function downloadCandidate(candidate, destination) {
  const response = await fetchWithRetry(candidate.downloadUrl, {
    accept: "image/jpeg",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(`Downloaded file is not a JPEG (${response.headers.get("content-type")})`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const temporaryPath = `${destination}.part`;
  await writeFile(temporaryPath, bytes);
  try {
    await unlink(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rename(temporaryPath, destination);
  return sha256;
}

function fallbackQueries(step) {
  const regions = {
    D1: "Tokyo Yokohama travel Japan",
    D2: "Lake Kawaguchi Mount Fuji travel",
    D3: "Osaka Kyoto travel Japan",
    D4: "Kyoto Higashiyama traditional Japan",
    D5: "Kyoto Uji railway travel",
    D6: "Kyoto Wakayama Shirahama travel",
    D7: "Kumano Kodo Wakayama travel",
    D8: "Wakayama Kansai Airport railway",
  };
  return [
    step.searchQuery,
    `${step.searchQuery} Japan`,
    `${regions[step.dayId]} ${step.title.includes("晚餐") || step.title.includes("午餐") ? "food" : "scene"}`,
  ];
}

async function writeCreditsData(credits) {
  const ordered = steps
    .map(({ id }) => credits.find(({ stepId }) => stepId === id))
    .filter(Boolean);
  const source = `// Generated by scripts/fetch-commons-images.mjs from Wikimedia Commons API metadata.\nexport const imageCredits = ${JSON.stringify(ordered, null, 2)};\n`;
  await writeFile(creditsPath, source, "utf8");
}

async function writeCreditsHtml(credits) {
  const ordered = steps
    .map((step) => ({
      step,
      credit: credits.find(({ stepId }) => stepId === step.id),
    }))
    .filter(({ credit }) => credit);
  const rows = ordered
    .map(
      ({ step, credit }) => `              <tr data-step-id="${escapeHtml(credit.stepId)}">
                <td><code>${escapeHtml(credit.localFile)}</code></td>
                <td><a href="${escapeHtml(credit.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(credit.commonsTitle)}</a><br><small>${escapeHtml(step.title)}</small></td>
                <td>${escapeHtml(credit.author)}</td>
                <td><a href="${escapeHtml(credit.licenseUrl)}" target="_blank" rel="noopener">${escapeHtml(credit.license)}</a></td>
                <td><a href="${escapeHtml(credit.sourceUrl)}" target="_blank" rel="noopener">Wikimedia Commons</a></td>
                <td>${escapeHtml(credit.retrievedAt)}</td>
              </tr>`,
    )
    .join("\n");
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="JP2609 行程所用 Wikimedia Commons 图片的真实作者与许可证署名。" />
    <meta name="theme-color" content="#1f3a2e" />
    <title>图片署名 · JP2609</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">跳到主要内容</a>
    <header class="site-header">
      <div class="site-brand">
        <p class="eyebrow">Credits</p>
        <h1>图片署名</h1>
        <p class="lede">本页列出行程全部 ${ordered.length} 张 Wikimedia Commons 实景图的原始文件、作者与许可证。信息由 Commons API 元数据生成。</p>
      </div>
    </header>
    <nav class="site-nav" aria-label="页面分区">
      <a href="index.html">返回路书</a>
      <a href="index.html#itinerary">逐日行程</a>
      <a href="index.html#bookings">已预约</a>
      <a href="index.html#pending">待办理</a>
      <a href="index.html#fallbacks">应急预案</a>
    </nav>
    <main id="main">
      <section class="panel" aria-labelledby="policy-title">
        <header class="panel-header">
          <h2 id="policy-title">署名说明</h2>
          <p>作者、许可证和来源链接取自下载时的 Wikimedia Commons 元数据；取用日期为脚本实际下载日期。</p>
        </header>
      </section>
      <section class="panel" aria-labelledby="table-title">
        <header class="panel-header">
          <h2 id="table-title">Commons 署名表（${ordered.length} 张）</h2>
          <p>点击原图标题可核验文件说明页，点击许可证名称可查看许可条款。</p>
        </header>
        <div class="booking-card">
          <table>
            <caption>Wikimedia Commons 图片署名记录</caption>
            <thead>
              <tr>
                <th scope="col">本地文件</th>
                <th scope="col">原图标题 / 行程步骤</th>
                <th scope="col">作者</th>
                <th scope="col">许可证</th>
                <th scope="col">来源</th>
                <th scope="col">取用日期</th>
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
      </section>
    </main>
    <footer class="site-footer"><p><a href="index.html">返回路书首页</a></p></footer>
  </body>
</html>
`;
  await writeFile(creditsHtmlPath, html, "utf8");
}

async function persist(credits, failures) {
  await Promise.all([
    writeCreditsData(credits),
    writeCreditsHtml(credits),
    writeFile(failuresPath, `${JSON.stringify(failures, null, 2)}\n`, "utf8"),
  ]);
}

async function main() {
  await mkdir(imageDirectory, { recursive: true });
  const existingCredits = await readExistingCredits();
  const credits = [];
  const failures = [];
  const usedCommonsSha1 = new Set();
  const usedSha256 = new Set();
  const usedTitles = new Set();

  for (const step of steps) {
    const existing = existingCredits.find(({ stepId }) => step.id === stepId);
    const destination = resolve(imageDirectory, `${step.id}.jpg`);
    if (existing && isCompleteCredit(existing)) {
      try {
        const actualSha256 = await sha256File(destination);
        if (actualSha256 === existing.sha256 && !usedSha256.has(actualSha256)) {
          credits.push(existing);
          usedSha256.add(actualSha256);
          usedCommonsSha1.add(existing.commonsSha1);
          usedTitles.add(existing.commonsTitle);
          console.log(`[${credits.length}/${steps.length}] skip ${step.id} ${step.title}`);
          continue;
        }
      } catch (error) {
        if (error.code !== "ENOENT") console.warn(`  resume check: ${error.message}`);
      }
    }

    console.log(`[${credits.length + 1}/${steps.length}] fetch ${step.id} ${step.title}`);
    try {
      let selected;
      for (const query of fallbackQueries(step)) {
        const pages = await searchCommons(query);
        const candidates = pages
          .map(candidateCredit)
          .filter(Boolean)
          .filter(
            (candidate) =>
              !usedCommonsSha1.has(candidate.commonsSha1) &&
              !usedTitles.has(candidate.commonsTitle),
          );
        for (const candidate of candidates) {
          const sha256 = await downloadCandidate(candidate, destination);
          if (usedSha256.has(sha256)) {
            await unlink(destination);
            continue;
          }
          selected = { ...candidate, sha256, searchQuery: query };
          break;
        }
        if (selected) break;
      }
      if (!selected) throw new Error("No unused JPEG with complete attribution metadata found");

      const { downloadUrl, ...metadata } = selected;
      const credit = {
        stepId: step.id,
        localFile: `assets/images/${step.id}.jpg`,
        ...metadata,
        retrievedAt: new Date().toISOString().slice(0, 10),
      };
      credits.push(credit);
      usedCommonsSha1.add(credit.commonsSha1);
      usedSha256.add(credit.sha256);
      usedTitles.add(credit.commonsTitle);
      await persist(credits, failures);
      await delay(200);
    } catch (error) {
      failures.push({
        stepId: step.id,
        title: step.title,
        searchQuery: step.searchQuery,
        error: error.message,
        failedAt: new Date().toISOString(),
      });
      console.error(`  FAILED: ${error.message}`);
      await persist(credits, failures);
    }
  }

  await persist(credits, failures);
  console.log(`Completed: ${credits.length} downloaded, ${failures.length} failed.`);
  if (failures.length) process.exitCode = 1;
}

await main();
