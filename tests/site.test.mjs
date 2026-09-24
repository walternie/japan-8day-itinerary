import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { bookingRows, confirmedBookings, days } from "../data/itinerary.js";
import {
  escapeHtml,
  getDirectionsUrl,
  getMapSearchUrl,
  getPendingBookingRows,
  getStepImageFilename,
  getStepImagePath,
  renderConfirmedBookings,
  renderDay,
  renderRoadbook,
  renderStep,
  shouldShowMap,
} from "../lib/site.js";

test("escapes unsafe HTML characters", () => {
  assert.equal(
    escapeHtml(`<a href="/x?a=1&b='2'">"东京"</a>`),
    "&lt;a href=&quot;/x?a=1&amp;b=&#39;2&#39;&quot;&gt;&quot;东京&quot;&lt;/a&gt;",
  );
});

test("builds encoded official Google Maps search and directions URLs", () => {
  assert.equal(
    getMapSearchUrl({ mapQuery: "清水寺 京都 & 日本" }),
    "https://www.google.com/maps/search/?api=1&query=%E6%B8%85%E6%B0%B4%E5%AF%BA%20%E4%BA%AC%E9%83%BD%20%26%20%E6%97%A5%E6%9C%AC",
  );
  assert.equal(
    getDirectionsUrl("南禅寺 京都", "清水寺 京都"),
    "https://www.google.com/maps/dir/?api=1&origin=%E5%8D%97%E7%A6%85%E5%AF%BA%20%E4%BA%AC%E9%83%BD&destination=%E6%B8%85%E6%B0%B4%E5%AF%BA%20%E4%BA%AC%E9%83%BD",
  );
});

test("hides maps for generic travel steps and shows them for real places", () => {
  for (const title of [
    "起床与早餐",
    "横滨站西口候车",
    "入境、取行李",
    "温泉与休息",
    "退房并寄存行李",
    "早餐与整理行李",
    "NH962 北京→羽田",
    "托运与安检",
  ]) {
    assert.equal(shouldShowMap({ title }), false, title);
  }

  for (const title of [
    "清水寺",
    "富士急乐园",
    "Nintendo Museum",
    "南禅寺",
    "炭櫓鳗鱼晚餐",
  ]) {
    assert.equal(shouldShowMap({ title }), true, title);
  }

  for (const title of ["横滨晚餐", "胜浦早晚餐"]) {
    assert.equal(shouldShowMap({ title }), false, title);
  }
});

test("honors exact mapEnabled overrides in itinerary data", () => {
  const expectations = new Map([
    ["步行至Mont-bell京都駅前店", true],
    ["步行至河原町炭櫓", true],
    ["鸭川后返回酒店", true],
    ["温泉与拉伸", false],
  ]);

  for (const [title, expected] of expectations) {
    const matches = days
      .flatMap(({ steps }) => steps)
      .filter((step) => step.title === title);
    assert.equal(matches.length, 1, title);
    assert.equal(matches[0].mapEnabled, expected, title);
    assert.equal(shouldShowMap(matches[0]), expected, title);
  }
});

test("directions use the complete previous step including map override", () => {
  const destination = {
    id: "destination",
    time: "10:00",
    title: "清水寺",
    detail: "参观",
    mapQuery: "清水寺 京都",
  };
  const enabledOrigin = {
    title: "步行至河原町炭櫓",
    mapQuery: "炭櫓 京都河原町",
    mapEnabled: true,
  };
  const disabledOrigin = {
    title: "温泉与拉伸",
    mapQuery: "白滨 日本",
    mapEnabled: false,
  };

  assert.match(renderStep(destination, enabledOrigin), /从上一地点导航/);
  assert.doesNotMatch(renderStep(destination, disabledOrigin), /从上一地点导航/);
});

test("renders all 101 steps with required broad map classifications", () => {
  const allSteps = days.flatMap(({ steps }) => steps);
  assert.equal(allSteps.length, 101);

  for (const title of [
    "富士急乐园",
    "清水寺",
    "Nintendo Museum",
    "步行至Mont-bell京都駅前店",
    "步行至河原町炭櫓",
    "鸭川后返回酒店",
  ]) {
    const step = allSteps.find((entry) => entry.title === title);
    assert.ok(step, title);
    assert.equal(shouldShowMap(step), true, title);
  }

  for (const title of [
    "起床与早餐",
    "入境、取行李",
    "抵达横滨站西口候车",
    "退房并寄存行李",
    "温泉与拉伸",
    "NH962 北京→羽田",
  ]) {
    const step = allSteps.find((entry) => entry.title === title);
    assert.ok(step, title);
    assert.equal(shouldShowMap(step), false, title);
  }

  assert.ok(allSteps.every((step) => typeof shouldShowMap(step) === "boolean"));
  const rendered = days.map((day) => renderDay(day)).join("");
  assert.equal((rendered.match(/class="step-card"/g) ?? []).length, 101);
});

test("provides one unique expected image path for every step", () => {
  const steps = days.flatMap(({ steps }) => steps);
  const paths = steps.map(getStepImagePath);

  assert.equal(paths.length, 101);
  assert.equal(new Set(paths).size, 101);
  for (let index = 0; index < steps.length; index += 1) {
    const filename = getStepImageFilename(steps[index]);
    assert.equal(paths[index], `assets/images/${filename}`);
    assert.match(filename, /^D\d+-/u);
    assert.ok(filename.includes(steps[index].title.replace(/[\\/:*?"<>|#%]/gu, "-")));
  }
});

test("roadbook links target the exact step IDs", () => {
  for (const day of days) {
    const html = renderRoadbook(day);
    const targets = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(targets, day.steps.map(({ id }) => id));
    for (const step of day.steps) {
      assert.match(renderStep(step), new RegExp(`id="${step.id}"`));
    }
  }
});

test("renders exactly eleven confirmed bookings with purchased D2 return", () => {
  const html = renderConfirmedBookings(confirmedBookings);

  assert.equal((html.match(/class="booking-card"/g) ?? []).length, 11);
  assert.doesNotMatch(html, /河口湖17:40/);
  assert.doesNotMatch(html, /炭櫓京都四条河原町店/);
  assert.match(html, /山中湖18:07→横滨20:11/);
  assert.match(html, /京やきにく弘 祇园山名庵/);
  assert.match(html, /预约号#110886/);
  assert.match(html, /黑潮1号普通车指定席/);
  assert.match(html, /黑潮36号普通车指定席/);
  assert.match(html, /黑潮18号普通车指定席/);
  assert.match(html, /纪伊胜浦18:04→白滨19:30/);
  assert.match(html, /白滨11:20→日根野13:08/);
  assert.match(html, /3号车17C、17D/);
});

test("pending booking filter excludes cancelled, locked, completed, and verified items", () => {
  const pending = getPendingBookingRows(bookingRows);
  const text = JSON.stringify(pending);

  assert.equal(pending.length, 3);
  assert.doesNotMatch(text, /D2往返高速巴士|关西广域周游券|D6黑潮9号|D7黑潮往返|D8黑潮号|D3午餐|D3鳗鱼|D4和牛|D2山中湖KABA|D2本地公交/);
  assert.ok(pending.every(([status]) => !["已取消", "已锁定", "已完成", "已核对"].includes(status)));
});

test("static pages use relative local paths suitable for a GitHub Pages subpath", async () => {
  const [indexHtml, creditsHtml] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../credits.html", import.meta.url), "utf8"),
  ]);

  assert.match(indexHtml, /src="app\.js"/);
  assert.match(indexHtml, /href="styles\.css"/);
  assert.match(indexHtml, /href="credits\.html"/);
  assert.doesNotMatch(indexHtml, /(?:src|href)="\/(?!\/)/);
  assert.doesNotMatch(creditsHtml, /(?:src|href)="\/(?!\/)/);
});

test("day picker is a pressed-button group, not incomplete tabs", async () => {
  const [indexHtml, appSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app.js", import.meta.url), "utf8"),
  ]);

  assert.match(
    indexHtml,
    /id="day-tabs"[\s\S]*?role="group"[\s\S]*?aria-label="选择旅行日"/,
  );
  assert.doesNotMatch(indexHtml, /role="tablist"/);
  assert.match(appSource, /aria-pressed=/);
  assert.match(appSource, /setAttribute\("aria-pressed", String\(selected\)\)/);
  assert.doesNotMatch(appSource, /aria-selected|role="tab"/);
});
