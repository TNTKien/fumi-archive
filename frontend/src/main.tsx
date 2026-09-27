import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Badge,
  Button,
  GlitchText,
  Progress,
  ScanDivider,
  TacticalPanel
} from "reend-components";
import "reend-components/styles.css";
import "./styles.css";

type ImageItem = {
  id: string;
  directUrl: string;
  srcUrl?: string;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  createdAt: string;
};

type TurnstileApi = {
  render: (
    selector: string | HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const MAX_BYTES = 2 * 1024 * 1024;

function App() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [uploadAvailability, setUploadAvailability] = useState<"checking" | "online" | "offline">("checking");
  const widgetIdRef = useRef<string | null>(null);

  const filePreviewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : ""),
    [file]
  );

  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  const totalLoaded = images.length;
  const uploadReady = Boolean(file && turnstileToken && uploadState !== "uploading");

  const latestDate = useMemo(() => {
    if (!images.length) return "NO DATA";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      year: "numeric"
    }).format(new Date(images[0].createdAt));
  }, [images]);

  useEffect(() => {
    void loadImages(false);

    let cancelled = false;

    async function loadUploadAvailability() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));

        if (!response.ok || body.success === false) {
          throw new Error("Status unavailable");
        }

        if (!cancelled) {
          setUploadAvailability(body.uploadAvailable ? "online" : "offline");
        }
      } catch {
        if (!cancelled) setUploadAvailability("offline");
      }
    }

    void loadUploadAvailability();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function setupTurnstile() {
      try {
        const response = await fetch("/api/config", { cache: "no-store" });
        const config = await response.json();

        if (!response.ok || !config.turnstileSiteKey) {
          throw new Error("Verification is unavailable.");
        }

        await loadTurnstileScript();
        if (cancelled || !window.turnstile) return;

        widgetIdRef.current = window.turnstile.render("#turnstile-container", {
          sitekey: config.turnstileSiteKey,
          action: "upload",
          theme: "dark",
          size: window.matchMedia("(max-width: 360px)").matches ? "compact" : "flexible",
          callback(token) {
            setTurnstileToken(token);
            setTurnstileReady(true);
          },
          "expired-callback"() {
            setTurnstileToken("");
            setTurnstileReady(false);
          },
          "error-callback"() {
            setTurnstileToken("");
            setTurnstileReady(false);
            setUploadMessage("Verification failed to initialize.");
          }
        });
      } catch (error) {
        setUploadMessage(error instanceof Error ? error.message : "Verification is unavailable.");
      }
    }

    void setupTurnstile();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadImages(append: boolean) {
    if (!append) {
      setGalleryLoading(true);
      setGalleryError("");
    }

    try {
      const params = new URLSearchParams({ limit: "36" });
      if (append && cursor) params.set("cursor", cursor);

      const response = await fetch("/api/images?" + params.toString(), {
        cache: "no-store"
      });
      const body = await response.json();

      if (!response.ok || body.success === false) {
        throw new Error(body.error || "Could not load archive.");
      }

      setImages((current) => (append ? [...current, ...body.images] : body.images));
      setCursor(body.nextCursor || null);
    } catch (error) {
      setGalleryError(error instanceof Error ? error.message : "Could not load archive.");
    } finally {
      setGalleryLoading(false);
    }
  }

  function selectFile(next: File | null) {
    if (!next) return;

    if (next.type !== "image/jpeg" && next.type !== "image/png") {
      setFile(null);
      setUploadState("error");
      setUploadMessage("Only JPEG and PNG images are supported.");
      return;
    }

    if (next.size <= 0 || next.size > MAX_BYTES) {
      setFile(null);
      setUploadState("error");
      setUploadMessage("Image must be 2 MB or smaller.");
      return;
    }

    setFile(next);
    setUploadState("idle");
    setUploadMessage("");
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (uploadState === "uploading") return;
    selectFile(event.dataTransfer.files?.[0] || null);
  }

  async function handleUpload() {
    if (!file || !turnstileToken) return;

    setUploadState("uploading");
    setUploadMessage("TRANSMITTING IMAGE TO ARCHIVE…");

    try {
      const data = new FormData();
      data.append("file", file);
      data.append("cf-turnstile-response", turnstileToken);

      const response = await fetch("/api/images", {
        method: "POST",
        body: data
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        if (
          response.status === 503 &&
          typeof body.error === "string" &&
          body.error.toLowerCase().includes("authentication expired")
        ) {
          setUploadAvailability("offline");
        }

        throw new Error(body.error || "Upload failed.");
      }

      setUploadAvailability("online");
      setImages((current) => [body.image, ...current]);
      setUploadState("success");
      setUploadMessage("ARCHIVED // IMAGE IS NOW PUBLIC");
      setFile(null);

      window.setTimeout(() => {
        setUploadState("idle");
        setUploadMessage("");
      }, 1600);
    } catch (error) {
      setUploadState("error");
      setUploadMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setTurnstileToken("");
      setTurnstileReady(false);
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a href="/" className="brand-lockup" aria-label="Fumi Archive home">
          <span className="brand-symbol">ᗜˬᗜ</span>
          <span className="brand-copy">
            <strong>FUMI ARCHIVE</strong>
          </span>
        </a>

        <div
          className={"upload-status upload-status-" + uploadAvailability}
          role="status"
          aria-live="polite"
          title="Upload service status"
        >
          <span className="upload-status-diamond" aria-hidden="true" />
          <span>
            {uploadAvailability === "checking"
              ? "CHECKING"
              : uploadAvailability === "online"
                ? "ONLINE"
                : "OFFLINE"}
          </span>
        </div>
      </header>

      <main>
        <section className="hero-grid">
          <div className="hero-copy">
            <p className="section-kicker">PUBLIC ARCHIVE // NODE 01</p>
            <h1>
              <GlitchText intensity="low">ARCHIVE THE PLUSHIES.</GlitchText>
            </h1>
            <p className="hero-lead">
              A small public archive for fumo and plushie photos. Upload one image,
              pass verification, and it joins the collection.
            </p>

            <div className="hero-stats">
              <div>
                <span>LOADED</span>
                <strong>{String(totalLoaded).padStart(3, "0")}</strong>
              </div>
              <div>
                <span>LATEST</span>
                <strong>{latestDate}</strong>
              </div>
              <div>
                <span>FORMAT</span>
                <strong>JPG / PNG</strong>
              </div>
            </div>
          </div>

          <TacticalPanel
            title="UPLOAD TERMINAL"
            status={uploadState === "error" ? "warning" : uploadState === "uploading" ? "scanning" : "online"}
            className="upload-panel"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              hidden
              style={{ display: "none" }}
              onChange={(event) => {
                selectFile(event.target.files?.[0] || null);
                event.currentTarget.value = "";
              }}
            />

            <div
              className={"upload-dropzone" + (dragActive ? " is-dragging" : "")}
              role="button"
              tabIndex={0}
              aria-label="Choose an image to upload"
              onClick={() => uploadState !== "uploading" && fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && uploadState !== "uploading") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (uploadState !== "uploading") setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <span className="upload-dropzone-icon" aria-hidden="true">◇</span>
              <div className="upload-dropzone-copy">
                <strong>DROP IMAGE HERE</strong>
                <span>JPEG / PNG · MAX 2 MB</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                tabIndex={-1}
                disabled={uploadState === "uploading"}
                onClick={(event) => {
                  event.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                BROWSE IMAGE
              </Button>
            </div>

            {file && (
              <div className="upload-preview">
                <img src={filePreviewUrl} alt="" />
                <div className="upload-preview-copy">
                  <div className="upload-preview-heading">
                    <Badge variant="success">READY</Badge>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                  <strong title={file.name}>{file.name}</strong>
                  <span>{file.type.replace("image/", "").toUpperCase()} IMAGE</span>
                </div>
                <button
                  type="button"
                  className="upload-remove"
                  aria-label="Remove selected image"
                  disabled={uploadState === "uploading"}
                  onClick={() => {
                    setFile(null);
                    setUploadState("idle");
                    setUploadMessage("");
                  }}
                >
                  ×
                </button>
              </div>
            )}

            <div className="verification-row">
              <div className="verification-copy">
                <span>HUMAN VERIFICATION</span>
                <Badge variant={turnstileReady ? "success" : "default"}>
                  {turnstileReady ? "READY" : "WAITING"}
                </Badge>
              </div>
              <div id="turnstile-container" />
            </div>

            {uploadState === "uploading" && (
              <div className="upload-progress">
                <div>
                  <span>TRANSMITTING</span>
                  <span>PLEASE WAIT</span>
                </div>
                <Progress size="sm" />
              </div>
            )}

            <Button
              size="lg"
              loading={uploadState === "uploading"}
              disabled={!uploadReady}
              onClick={handleUpload}
              className="upload-button"
            >
              ARCHIVE IMAGE
            </Button>

            {uploadMessage && uploadState !== "uploading" && (
              <p className={"terminal-message " + uploadState}>{uploadMessage}</p>
            )}
          </TacticalPanel>
        </section>

        <ScanDivider label="LATEST RECOVERY" />

        <section className="archive-section">
          <div className="archive-heading">
            <div>
              <p className="section-kicker">VISUAL INDEX // PUBLIC FEED</p>
              <h2>THE ARCHIVE</h2>
            </div>
            <div className="archive-meta">
              <span>{totalLoaded} LOADED</span>
              <span>◆</span>
              <span>DESCENDING TIME</span>
            </div>
          </div>

          {galleryError && <div className="archive-state error">{galleryError}</div>}

          {galleryLoading ? (
            <div className="gallery-grid loading-grid" aria-label="Loading archive">
              {Array.from({ length: 10 }).map((_, index) => (
                <div className="image-skeleton" key={index} />
              ))}
            </div>
          ) : images.length === 0 ? (
            <div className="archive-state">
              <strong>NO ARCHIVE ENTRIES</strong>
              <span>Be the first to add a plushie.</span>
            </div>
          ) : (
            <>
              <div className="gallery-grid">
                {images.map((image, index) => (
                  <ArchiveCard image={image} index={index} key={image.id} />
                ))}
              </div>

              {cursor && (
                <div className="load-more">
                  <Button variant="secondary" onClick={() => void loadImages(true)}>
                    LOAD MORE
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <strong>FUMI ARCHIVE</strong>
          <span>EXPERIMENTAL COMMUNITY IMAGE ARCHIVE</span>
        </div>
        <span>IMAGES SERVED VIA TIKTOK / BYTEDANCE CDN</span>
      </footer>
    </div>
  );
}

function ArchiveCard({ image, index }: { image: ImageItem; index: number }) {
  const [src, setSrc] = useState(image.directUrl);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(new Date(image.createdAt));

  function handleError() {
    if (!fallbackUsed && image.srcUrl) {
      setFallbackUsed(true);
      setSrc(image.srcUrl);
    }
  }

  return (
    <article className="archive-card">
      <a href={src} target="_blank" rel="noreferrer" className="archive-image-link">
        <img src={src} alt="" loading="lazy" decoding="async" onError={handleError} />
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <span className="entry-index">#{String(index + 1).padStart(3, "0")}</span>
      </a>

      <div className="archive-card-meta">
        <time dateTime={image.createdAt}>{date}</time>
        <span>{formatBytes(image.bytes)}</span>
      </div>
    </article>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(
    'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]'
  );

  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Turnstile.")), {
        once: true
      });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Turnstile."));
    document.head.appendChild(script);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
