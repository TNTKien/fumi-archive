const $ = (s) => document.querySelector(s);
const form = $("#uploadForm");
const input = $("#fileInput");
const label = $("#fileLabel");
const button = $("#uploadButton");
const status = $("#uploadStatus");
const gallery = $("#gallery");
const empty = $("#emptyState");
const loadMore = $("#loadMoreButton");
const count = $("#galleryCount");

let cursor = null;
let loaded = 0;

input.addEventListener("change", () => {
  label.textContent = input.files?.[0]?.name || "Choose an image";
  show("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return show("That image is larger than 2 MB.", "error");

  button.disabled = true;
  input.disabled = true;
  show("Uploading…", "working");

  try {
    const data = new FormData();
    data.append("file", file);
    const response = await fetch("/api/images", { method: "POST", body: data });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.error || "Upload failed.");

    gallery.prepend(card(body.image));
    loaded += 1;
    sync();
    input.value = "";
    label.textContent = "Choose an image";
    show("Archived! Your image is now public.", "success");
  } catch (error) {
    show(error.message || "Upload failed.", "error");
  } finally {
    button.disabled = false;
    input.disabled = false;
  }
});

loadMore.addEventListener("click", () => load(true));

async function load(append = false) {
  const params = new URLSearchParams({ limit: "36" });
  if (append && cursor) params.set("cursor", cursor);

  try {
    const response = await fetch("/api/images?" + params, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || body.success === false) throw new Error(body.error || "Could not load the archive.");

    if (!append) {
      gallery.replaceChildren();
      loaded = 0;
    }

    for (const image of body.images) {
      gallery.append(card(image));
      loaded += 1;
    }

    cursor = body.nextCursor || null;
    sync();
  } catch (error) {
    if (!append && gallery.childElementCount === 0) {
      empty.hidden = false;
      empty.textContent = error.message || "Could not load the archive.";
    }
  }
}

function card(image) {
  const article = document.createElement("article");
  article.className = "image-card";

  const link = document.createElement("a");
  link.className = "image-link";
  link.href = image.directUrl;
  link.target = "_blank";
  link.rel = "noreferrer";

  const img = document.createElement("img");
  img.src = image.directUrl;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";

  let fallback = false;
  img.addEventListener("error", () => {
    if (!fallback && image.srcUrl) {
      fallback = true;
      img.src = image.srcUrl;
      link.href = image.srcUrl;
    }
  });

  const meta = document.createElement("div");
  meta.className = "image-meta";
  const time = document.createElement("time");
  time.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(image.createdAt));
  const size = document.createElement("span");
  size.textContent = formatBytes(image.bytes);
  meta.append(time, size);

  link.append(img);
  article.append(link, meta);
  return article;
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function show(message, tone = "") {
  status.textContent = message;
  status.dataset.tone = tone;
}

function sync() {
  empty.hidden = loaded > 0;
  count.textContent = loaded ? loaded + " loaded" : "";
  loadMore.hidden = !cursor;
}

load();
