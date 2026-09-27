const gallery = document.querySelector("#adminGallery");
const empty = document.querySelector("#emptyState");
const statusMessage = document.querySelector("#statusMessage");
const summary = document.querySelector("#summary");
const adminIdentity = document.querySelector("#adminIdentity");
const filterButtons = [...document.querySelectorAll("[data-filter]")];
const testNotificationButton = document.querySelector("#testNotificationButton");

let currentFilter = "all";
let images = [];

testNotificationButton?.addEventListener("click", async () => {
  testNotificationButton.disabled = true;
  showStatus("Sending test notification…");

  try {
    const response = await fetch("/api/admin/discord/test", { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.success === false) {
      throw new Error(body.error || "Notification test failed.");
    }

    showStatus("Test notification sent.");
  } catch (error) {
    showStatus(error.message || "Notification test failed.", "error");
  } finally {
    testNotificationButton.disabled = false;
  }
});

filterButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    currentFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle("active", item === button));
    await loadImages();
  });
});

async function loadImages() {
  showStatus("Loading…");

  try {
    const params = new URLSearchParams({ limit: "100", status: currentFilter });
    const response = await fetch("/api/admin/images?" + params, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.success === false) {
      throw new Error(body.error || "Could not load admin images.");
    }

    images = body.images || [];
    adminIdentity.textContent = body.admin || "Authenticated admin";
    summary.textContent = images.length + " image" + (images.length === 1 ? "" : "s");
    render();
    showStatus("");
  } catch (error) {
    gallery.replaceChildren();
    empty.hidden = true;
    showStatus(error.message || "Could not load admin images.", "error");
  }
}

function render() {
  gallery.replaceChildren();
  empty.hidden = images.length > 0;

  for (const image of images) {
    gallery.append(createCard(image));
  }
}

function createCard(image) {
  const article = document.createElement("article");
  article.className = "card";
  article.dataset.status = image.status;

  const link = document.createElement("a");
  link.href = image.directUrl;
  link.target = "_blank";
  link.rel = "noreferrer";

  const img = document.createElement("img");
  img.src = image.directUrl;
  img.alt = "";
  img.loading = "lazy";

  let usedFallback = false;
  img.addEventListener("error", () => {
    if (!usedFallback && image.srcUrl) {
      usedFallback = true;
      img.src = image.srcUrl;
      link.href = image.srcUrl;
    }
  });

  const body = document.createElement("div");
  body.className = "card-body";

  const top = document.createElement("div");
  top.className = "card-top";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = image.status;

  const time = document.createElement("time");
  time.dateTime = image.createdAt;
  time.textContent = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(image.createdAt));

  const meta = document.createElement("p");
  meta.textContent = [image.mimeType, formatBytes(image.bytes)].filter(Boolean).join(" · ");

  const action = document.createElement("button");
  action.type = "button";
  action.className = image.status === "published" ? "danger" : "restore";
  action.textContent = image.status === "published" ? "Hide" : "Restore";
  action.addEventListener("click", () => changeStatus(image, action));

  top.append(badge, time);
  body.append(top, meta, action);
  link.append(img);
  article.append(link, body);

  return article;
}

async function changeStatus(image, button) {
  const nextStatus = image.status === "published" ? "hidden" : "published";
  button.disabled = true;
  showStatus(nextStatus === "hidden" ? "Hiding image…" : "Restoring image…");

  try {
    const response = await fetch(
      "/api/admin/images/" + encodeURIComponent(image.id) + "/status",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      }
    );

    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(body.error || "Admin action failed.");
    }

    image.status = nextStatus;

    if (currentFilter !== "all") {
      images = images.filter((item) => item.id !== image.id);
    }

    summary.textContent = images.length + " image" + (images.length === 1 ? "" : "s");
    render();
    showStatus(nextStatus === "hidden" ? "Image hidden from the public gallery." : "Image restored.");
  } catch (error) {
    button.disabled = false;
    showStatus(error.message || "Admin action failed.", "error");
  }
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function showStatus(message, tone = "") {
  statusMessage.textContent = message;
  statusMessage.dataset.tone = tone;
}

loadImages();
