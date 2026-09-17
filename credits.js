import { imageCredits } from "./data/image-credits.js";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function renderCredit(credit) {
  const sourceUrl = escapeHtml(safeHttpUrl(credit.sourceUrl));
  const licenseUrl = escapeHtml(safeHttpUrl(credit.licenseUrl));
  return `<tr data-step-id="${escapeHtml(credit.stepId)}">
    <td><code>${escapeHtml(credit.localFile)}</code></td>
    <td>${escapeHtml(credit.title)}</td>
    <td>${escapeHtml(credit.creator)}</td>
    <td><a href="${licenseUrl}" target="_blank" rel="noopener">${escapeHtml(credit.license)}</a></td>
    <td><a href="${sourceUrl}" target="_blank" rel="noopener">Flickr 原图</a></td>
    <td>${escapeHtml(credit.retrievedAt)}</td>
  </tr>`;
}

const body = document.querySelector("#credits-body");
const count = document.querySelector("#credits-count");

if (body) body.innerHTML = imageCredits.map(renderCredit).join("");
if (count) count.textContent = String(imageCredits.length);
