import {
  bookingRows,
  confirmedBookings,
  days,
  fallbackRows,
} from "./data/itinerary.js";
import {
  renderConfirmedBookings,
  renderDay,
  renderFallbacks,
  renderPendingBookings,
} from "./lib/site.js";

const dayTabs = document.querySelector("#day-tabs");
const dayPanels = document.querySelector("#day-panels");
const confirmedList = document.querySelector("#confirmed-list");
const pendingList = document.querySelector("#pending-list");
const fallbackList = document.querySelector("#fallback-list");

dayTabs.innerHTML = days
  .map(
    (day, index) =>
      `<button type="button" class="day-tab${index === 0 ? " is-active" : ""}" id="day-${day.id}" aria-controls="${day.id}" aria-pressed="${index === 0}">${day.id}<span>${day.date.split(" ")[0]}</span></button>`,
  )
  .join("");

dayPanels.innerHTML = days.map((day, index) => renderDay(day, index === 0)).join("");
confirmedList.innerHTML = renderConfirmedBookings(confirmedBookings);
pendingList.innerHTML = renderPendingBookings(bookingRows);
fallbackList.innerHTML = renderFallbacks(fallbackRows);

dayTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button[aria-controls]");
  if (!button) return;

  for (const tab of dayTabs.querySelectorAll("button")) {
    const selected = tab === button;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-pressed", String(selected));
  }

  for (const panel of dayPanels.querySelectorAll(".day-panel")) {
    panel.hidden = panel.id !== button.getAttribute("aria-controls");
  }

  document.querySelector(`#${button.getAttribute("aria-controls")}-title`)?.focus({
    preventScroll: true,
  });
});

async function sharePage() {
  const data = {
    title: document.title,
    text: "日本关西与富士山 8 日旅行路书",
    url: window.location.href,
  };

  if (navigator.share) {
    await navigator.share(data);
    return "已打开分享菜单";
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(data.url);
    return "链接已复制";
  }

  const textArea = document.createElement("textarea");
  textArea.value = data.url;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
  return "链接已复制";
}

const shareButton = document.querySelector("#share-button");
const shareStatus = document.querySelector("#share-status");

shareButton.addEventListener("click", async () => {
  try {
    shareStatus.textContent = await sharePage();
  } catch (error) {
    if (error?.name !== "AbortError") {
      shareStatus.textContent = "分享失败，请复制浏览器地址";
    }
  }
});
