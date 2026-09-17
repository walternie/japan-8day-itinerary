import test from "node:test";
import assert from "node:assert/strict";

import {
  days,
  bookingRows,
  confirmedBookings,
  fallbackRows,
  flightSummary,
  hotelSummary,
  createStepId,
} from "../data/itinerary.js";

const day = (id) => days.find((entry) => entry.id === id);
const allText = () =>
  JSON.stringify({ days, bookingRows, fallbackRows, flightSummary, hotelSummary });

test("contains complete D1-D8 itinerary with 105 stable, enriched steps", () => {
  assert.deepEqual(days.map(({ id }) => id), [
    "D1",
    "D2",
    "D3",
    "D4",
    "D5",
    "D6",
    "D7",
    "D8",
  ]);

  const steps = days.flatMap(({ steps }) => steps);
  assert.equal(steps.length, 105);
  assert.equal(new Set(steps.map(({ id }) => id)).size, 105);
  for (const { id: dayId, steps: daySteps } of days) {
    for (const step of daySteps) {
      assert.match(step.id, /^d[1-8]-[a-f0-9]{8}$/);
      assert.equal(step.id, createStepId(dayId, step.time, step.title));
    }
  }
  for (const step of steps) {
    assert.equal(typeof step.imageQuery, "string");
    assert.ok(step.imageQuery.length > 0);
    assert.equal(typeof step.mapQuery, "string");
    assert.ok(step.mapQuery.length > 0);
  }

  for (const { id, steps: daySteps } of days) {
    assert.ok(
      !("routeFrom" in daySteps[0]),
      `${id} first step must not have routeFrom`,
    );
    for (let index = 1; index < daySteps.length; index += 1) {
      assert.equal(typeof daySteps[index].routeFrom, "string");
      assert.ok(
        daySteps[index].routeFrom.length > 0,
        `${daySteps[index].id} routeFrom must not be empty`,
      );
      assert.equal(daySteps[index].routeFrom, daySteps[index - 1].title);
    }
  }
});

test("step IDs remain stable when a preceding step is inserted", () => {
  const d4 = day("D4");
  const originalIds = d4.steps.map(({ id }) => id);
  const withInsertedStep = [
    { time: "00:00", title: "虚拟前置步骤" },
    ...d4.steps,
  ].map(({ time, title }) => createStepId(d4.id, time, title));

  assert.deepEqual(withInsertedStep.slice(1), originalIds);
});

test("preserves the purchased D2 outbound and return bus facts", () => {
  const d2 = day("D2");
  assert.ok(d2.steps.some(({ time }) => time === "07:00–08:52"));
  assert.ok(
    d2.steps.some(
      ({ time, detail }) =>
        time === "18:07–20:11" &&
        detail.includes("车票已经购买") &&
        detail.includes("山中湖"),
    ),
  );
  assert.ok(
    bookingRows.some(
      (row) =>
        row.includes("D2往返高速巴士") &&
        row.some((cell) => cell.includes("山中湖18:07")),
    ),
  );
});

test("preserves D6 Kuroshio 9 and purchased Kansai Wide Pass facts", () => {
  const kuroshio9 = day("D6").steps.find(
    ({ time, title }) =>
      time === "11:13–13:47" && title.includes("黑潮9号"),
  );
  assert.ok(kuroshio9);
  assert.match(kuroshio9.detail, /3号车18C、18D/);

  assert.ok(
    bookingRows.some(
      (row) =>
        row.includes("关西广域周游券") &&
        row.some(
          (cell) =>
            cell.includes("已购买") &&
            cell.includes("9月29日") &&
            cell.includes("10月3日"),
        ),
    ),
  );
});

test("keeps a five-minute buffer between D6 checkout and walking", () => {
  const d6 = day("D6");
  const checkout = d6.steps.find(({ title }) => title === "退房并寄存行李");
  const walk = d6.steps.find(
    ({ title }) => title === "步行至Mont-bell京都駅前店",
  );

  assert.equal(checkout.time, "09:15–09:35");
  assert.equal(walk.time, "09:40–10:00");
});

test("preserves exact flight summaries and D5 Nintendo start time", () => {
  assert.deepEqual(flightSummary, [
    { flight: "NH962", route: "北京15:10 → 羽田19:35" },
    { flight: "NH19", route: "羽田10:00 → 伊丹约11:05" },
    { flight: "NH975", route: "关西15:55 → 浦东17:20" },
  ]);

  const nintendoMuseum = day("D5").steps.find(
    ({ title }) => title === "Nintendo Museum",
  );
  assert.ok(nintendoMuseum, "D5 Nintendo Museum step must exist");
  assert.match(nintendoMuseum.time, /^16:30/);
});

test("removes obsolete D2 return alternatives", () => {
  assert.doesNotMatch(allText(), /河口湖17:40/);
  assert.doesNotMatch(allText(), /18:30未售/);
});

test("preserves the D8 rail disruption fallback and flight priority", () => {
  const fallback = fallbackRows.find((row) => row[0] === "D8 线路风险");

  assert.ok(fallback, "D8 线路风险 fallback must exist");
  assert.match(fallback[1], /11:20黑潮18号/);
  assert.match(fallback[1], /前一晚转移到大阪\/KIX/);
  assert.equal(fallback[2], "国际航班优先");
});

test("exports notes plus flight and hotel summaries", () => {
  assert.ok(days.every(({ notes }) => Array.isArray(notes) && notes.length > 0));
  assert.equal(flightSummary.length, 3);
  assert.equal(hotelSummary.length, 3);
});

test("preserves D7 reserved Kuroshio 1 and Kuroshio 36 facts", () => {
  const outbound = day("D7").steps.find(({ title }) => title === "白滨→纪伊胜浦");
  const inbound = day("D7").steps.find(({ title }) => title === "返回白滨");

  assert.equal(outbound.time, "10:12–11:40");
  assert.match(outbound.detail, /黑潮1号/);
  assert.match(outbound.detail, /3号车17C、17D/);
  assert.equal(inbound.time, "18:04–19:30");
  assert.match(inbound.detail, /黑潮36号/);
  assert.match(inbound.detail, /2号车18C、18D/);
});

test("preserves D8 reserved Kuroshio 18 facts", () => {
  const hineno = day("D8").steps.find(({ title }) => title === "白滨→日根野");

  assert.equal(hineno.time, "11:20–13:08");
  assert.match(hineno.detail, /黑潮18号/);
  assert.match(hineno.detail, /6号车1C、1D/);
});

test("preserves D3 walk-in Sumiyagura dinner facts", () => {
  const dinner = day("D3").steps.find(({ title }) => title === "炭櫓鳗鱼晚餐");
  const walk = day("D3").steps.find(({ title }) => title === "步行至河原町炭櫓");

  assert.equal(walk.time, "18:00–18:40");
  assert.equal(dinner.time, "18:45–20:00");
  assert.match(dinner.detail, /18:45/);
  assert.match(dinner.detail, /无需预约/);
  assert.match(dinner.detail, /河原町/);
  assert.equal(
    confirmedBookings.some(({ id }) => id === "dinner-sumiyagura-20260928"),
    false,
  );
});

test("preserves D4 reserved Hiro Yamanaan dinner facts", () => {
  const dinner = day("D4").steps.find(({ title }) => title === "和牛晚餐");
  const walk = day("D4").steps.find(({ title }) => title === "祇园与花见小路");
  const booking = confirmedBookings.find(
    ({ id }) => id === "dinner-hiro-yamanaan-20260929",
  );

  assert.equal(dinner.time, "18:30–21:00");
  assert.equal(walk.time, "21:00–21:40");
  assert.match(dinner.detail, /#110886/);
  assert.match(dinner.detail, /たつみ/);
  assert.equal(booking.status, "已预约");
  assert.ok(booking.details.includes("预约号#110886"));
});

test("exports only the eleven confirmed bookings with exact purchased facts", () => {
  assert.equal(confirmedBookings.length, 11);
  assert.equal(
    new Set(confirmedBookings.map(({ id }) => id)).size,
    confirmedBookings.length,
  );
  assert.ok(
    confirmedBookings.every(
      ({ id, date, category, title, status, details }) =>
        typeof id === "string" &&
        id.length > 0 &&
        typeof date === "string" &&
        typeof category === "string" &&
        typeof title === "string" &&
        ["已购票", "已购买", "已预约", "已确定"].includes(status) &&
        Array.isArray(details) &&
        details.every((detail) => typeof detail === "string"),
    ),
  );

  assert.deepEqual(confirmedBookings, [
    {
      id: "flight-nh962",
      date: "9/26",
      category: "机票",
      title: "NH962 北京→东京",
      status: "已购票",
      details: ["北京首都T3 15:10→羽田T3 19:35"],
    },
    {
      id: "flight-nh19",
      date: "9/28",
      category: "机票",
      title: "NH19 东京→大阪",
      status: "已购票",
      details: ["羽田T2 10:00→伊丹约11:05"],
    },
    {
      id: "flight-nh975",
      date: "10/3",
      category: "机票",
      title: "NH975 大阪→上海",
      status: "已购票",
      details: ["关西T1 15:55→浦东17:20"],
    },
    {
      id: "bus-yokohama-kawaguchiko-roundtrip",
      date: "9/27",
      category: "高速巴士",
      title: "横滨⇄河口湖往返高速巴士",
      status: "已购票",
      details: [
        "横滨07:00→河口湖08:52",
        "山中湖18:07→横滨20:11",
      ],
    },
    {
      id: "pass-kansai-wide-area-5day",
      date: "9/29–10/3",
      category: "铁路周游券",
      title: "关西广域五日券",
      status: "已购买",
      details: ["有效期9/29–10/3"],
      party: "2位成人",
    },
    {
      id: "nintendo-museum-20260930",
      date: "9/30",
      category: "景点",
      title: "Nintendo Museum",
      status: "已预约",
      details: ["预约时间16:30"],
      party: "2位成人",
    },
    {
      id: "kuroshio-9-20261001",
      date: "10/1",
      category: "指定席",
      title: "黑潮9号普通车指定席",
      status: "已预约",
      details: ["新大阪11:13→白滨13:47", "普通车3号车18C、18D", "禁烟"],
      party: "2位成人",
    },
    {
      id: "kuroshio-1-20261002",
      date: "10/2",
      category: "指定席",
      title: "黑潮1号普通车指定席",
      status: "已预约",
      details: ["白滨10:12→纪伊胜浦11:40", "普通车3号车17C、17D", "禁烟"],
      party: "2位成人",
    },
    {
      id: "kuroshio-36-20261002",
      date: "10/2",
      category: "指定席",
      title: "黑潮36号普通车指定席",
      status: "已预约",
      details: ["纪伊胜浦18:04→白滨19:30", "普通车2号车18C、18D", "禁烟"],
      party: "2位成人",
    },
    {
      id: "kuroshio-18-20261003",
      date: "10/3",
      category: "指定席",
      title: "黑潮18号普通车指定席",
      status: "已预约",
      details: ["白滨11:20→日根野13:08", "普通车6号车1C、1D", "禁烟"],
      party: "2位成人",
    },
    {
      id: "dinner-hiro-yamanaan-20260929",
      date: "9/29",
      category: "餐厅",
      title: "京やきにく弘 祇园山名庵",
      status: "已预约",
      details: [
        "预约号#110886",
        "9/29 18:30入–21:00离",
        "たつみコース ¥6,000×2",
      ],
      party: "2位成人",
    },
  ]);

  const confirmedText = JSON.stringify(confirmedBookings);
  assert.match(confirmedText, /山中湖18:07→横滨20:11/);
  assert.doesNotMatch(confirmedText, /河口湖17:40/);
  assert.doesNotMatch(confirmedText, /炭櫓京都四条河原町店/);

  const pendingBookingTitles = bookingRows
    .filter(
      ([status, title]) =>
        !["已取消", "已锁定", "已完成"].includes(status) &&
        (title === "D7黑潮往返" || title === "D8黑潮号"),
    )
    .map((row) => row[1]);
  assert.deepEqual(pendingBookingTitles, []);
  assert.ok(
    pendingBookingTitles.every(
      (pendingTitle) =>
        !confirmedBookings.some(({ title }) => title === pendingTitle),
    ),
  );
});
