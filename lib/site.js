import { localImageExtensions } from "../data/local-image-extensions.js";

const GENERIC_STEP_PATTERN =
  /早餐|候车|入境|取行李|休息|退房|整理行李|收拾|飞行|托运|安检|登机口|值机|补给|缓冲|换乘|返程|入住|回酒店|前往.+站|抵达.+机场|NH\d+|起床/iu;
const GENERIC_MEAL_PATTERN = /^(?:横滨晚餐|胜浦早晚餐)$/u;

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function shouldShowMap(step) {
  if (typeof step?.mapEnabled === "boolean") return step.mapEnabled;

  const title = String(step?.title ?? "").trim();
  if (
    !title ||
    GENERIC_STEP_PATTERN.test(title) ||
    GENERIC_MEAL_PATTERN.test(title) ||
    /→|⇄/u.test(title)
  ) {
    return false;
  }

  return !/^(步行|返回|按体力|快速购买|购买)/u.test(title);
}

export function getMapSearchUrl(step) {
  const query = step?.mapQuery || `${step?.title ?? ""} 日本`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function getDirectionsUrl(origin, destination) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
}

export function getStepImageBasename(step) {
  const day = step.id.match(/^d\d+/iu)?.[0].toUpperCase() ?? "STEP";
  const sanitize = (value) => String(value)
    .replace(/[\\/:*?"<>|#%]/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/[. ]+$/gu, "")
    .trim();
  return `${day}-${sanitize(step.time)}-${sanitize(step.title)}`;
}

export function getStepImageFilename(step) {
  const basename = getStepImageBasename(step);
  const extension = localImageExtensions[basename] ?? "jpg";
  return `${basename}.${extension}`;
}

export function getStepImagePath(step) {
  return `assets/images/${getStepImageFilename(step)}`;
}

function renderTag(value, type) {
  if (!value) return "";
  return `<span class="step-tag step-tag--${type}">${escapeHtml(value)}</span>`;
}

export function renderStep(step, previousStep) {
  const showMap = shouldShowMap(step);
  const showDirections =
    showMap &&
    previousStep &&
    shouldShowMap(previousStep);
  const links = [
    showMap
      ? `<a class="map-link" href="${getMapSearchUrl(step)}" target="_blank" rel="noopener">在 Google Maps 查看</a>`
      : "",
    showDirections
      ? `<a class="map-link map-link--secondary" href="${getDirectionsUrl(
          previousStep.mapQuery || `${previousStep.title} 日本`,
          step.mapQuery || `${step.title} 日本`,
        )}" target="_blank" rel="noopener">从上一地点导航</a>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  return `<article class="step-card" id="${escapeHtml(step.id)}">
    <figure class="step-media">
      <img src="${escapeHtml(getStepImagePath(step))}" alt="${escapeHtml(step.title)}" loading="lazy" width="640" height="360">
    </figure>
    <div class="step-content">
      <p class="step-time">${escapeHtml(step.time)}</p>
      <h3>${escapeHtml(step.title)}</h3>
      <p>${escapeHtml(step.detail)}</p>
      <div class="step-meta">${renderTag(step.transport, "transport")}${renderTag(step.meal, "meal")}</div>
      ${links ? `<div class="step-links">${links}</div>` : ""}
    </div>
  </article>`;
}

export function renderRoadbook(day) {
  return `<nav class="roadbook" aria-label="${escapeHtml(day.id)} 当日编号路书">
    <ol>${day.steps
      .map(
        (step, index) =>
          `<li><a href="#${escapeHtml(step.id)}"><span>${index + 1}</span>${escapeHtml(step.title)}</a></li>`,
      )
      .join("")}</ol>
  </nav>`;
}

export function renderDay(day, active = false) {
  return `<section class="day-panel" id="${escapeHtml(day.id)}" aria-labelledby="${escapeHtml(day.id)}-title"${active ? "" : " hidden"}>
    <header class="day-header">
      <p class="eyebrow">${escapeHtml(day.id)} · ${escapeHtml(day.date)}</p>
      <h2 id="${escapeHtml(day.id)}-title" tabindex="-1">${escapeHtml(day.title)}</h2>
      <dl class="day-facts">
        <div><dt>酒店</dt><dd>${escapeHtml(day.hotel)}</dd></div>
        <div><dt>节奏</dt><dd>${escapeHtml(day.pace)}</dd></div>
      </dl>
      <p class="day-summary">${escapeHtml(day.summary)}</p>
    </header>
    ${renderRoadbook(day)}
    <div class="steps">${day.steps
      .map((step, index, steps) => renderStep(step, steps[index - 1]))
      .join("")}</div>
    <aside class="day-notes" aria-label="${escapeHtml(day.id)} 注意事项">
      <h3>当日提醒</h3>
      <ul>${day.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
    </aside>
  </section>`;
}

export function renderConfirmedBookings(bookings) {
  return bookings
    .map(
      (booking) => `<article class="booking-card">
        <div class="booking-heading">
          <p class="eyebrow">${escapeHtml(booking.date)} · ${escapeHtml(booking.category)}</p>
          <span class="status">${escapeHtml(booking.status)}</span>
        </div>
        <h3>${escapeHtml(booking.title)}</h3>
        <ul>${booking.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>
        ${booking.party ? `<p class="booking-party">${escapeHtml(booking.party)}</p>` : ""}
      </article>`,
    )
    .join("");
}

export function getPendingBookingRows(rows) {
  const excludedStatuses = new Set(["已取消", "已锁定", "已完成", "已核对"]);
  return rows.filter(([status]) => !excludedStatuses.has(status));
}

export function renderPendingBookings(rows) {
  return getPendingBookingRows(rows)
    .map(
      ([when, title, detail, priority]) => `<li class="task-card">
        <div><span class="task-when">${escapeHtml(when)}</span><span class="priority">优先级 ${escapeHtml(priority)}</span></div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(detail)}</p>
      </li>`,
    )
    .join("");
}

export function renderFallbacks(rows) {
  return rows
    .map(
      ([condition, action, boundary]) => `<article class="fallback-card">
        <h3>${escapeHtml(condition)}</h3>
        <p>${escapeHtml(action)}</p>
        <p class="fallback-boundary">${escapeHtml(boundary)}</p>
      </article>`,
    )
    .join("");
}
