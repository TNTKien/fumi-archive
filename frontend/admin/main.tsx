import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  GlitchText,
  ScanDivider,
  SonnerToaster,
  Tabs,
  TabsList,
  TabsTrigger,
  TacticalBadge,
  notify
} from "reend-components";
import "reend-components/styles.css";
import "../src/styles.css";
import "./admin.css";

type AdminImage = {
  id: string;
  directUrl: string;
  srcUrl?: string;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  createdAt: string;
  status: "published" | "hidden";
};

type Filter = "all" | "published" | "hidden";

function AdminApp() {
  const [images, setImages] = useState<AdminImage[]>([]);
  const [adminEmail, setAdminEmail] = useState("Authenticated admin");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);

  const counts = useMemo(() => {
    const published = images.filter((image) => image.status === "published").length;
    const hidden = images.filter((image) => image.status === "hidden").length;
    return { all: images.length, published, hidden };
  }, [images]);

  const visibleImages = useMemo(() => {
    if (filter === "all") return images;
    return images.filter((image) => image.status === filter);
  }, [filter, images]);

  useEffect(() => {
    void loadImages();
  }, []);

  async function loadImages() {
    setLoading(true);

    try {
      const params = new URLSearchParams({ limit: "100", status: "all" });
      const response = await fetch("/api/admin/images?" + params.toString(), {
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        throw new Error(body.error || "Could not load moderation data.");
      }

      setImages(body.images || []);
      setAdminEmail(body.admin || "Authenticated admin");
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : "Could not load moderation data.",
        { duration: 5000 }
      );
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(image: AdminImage) {
    const nextStatus = image.status === "published" ? "hidden" : "published";
    setBusyId(image.id);

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
        throw new Error(body.error || "Moderation action failed.");
      }

      setImages((current) =>
        current.map((item) =>
          item.id === image.id ? { ...item, status: nextStatus } : item
        )
      );

      notify.success(
        nextStatus === "hidden"
          ? "Image hidden from the public archive."
          : "Image restored to the public archive.",
        {
          description:
            nextStatus === "hidden"
              ? "It will no longer appear in the public gallery."
              : "It is visible in the public gallery again."
        }
      );
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : "Moderation action failed.",
        { duration: 5000 }
      );
    } finally {
      setBusyId(null);
    }
  }

  async function testNotification() {
    setNotificationBusy(true);

    try {
      const response = await fetch("/api/admin/discord/test", { method: "POST" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        throw new Error(body.error || "Notification test failed.");
      }

      notify.success("Discord test notification sent.");
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : "Notification test failed.",
        { duration: 5000 }
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  return (
    <>
      <SonnerToaster position="top-right" />
      <div className="site-shell admin-shell">
      <header className="topbar">
        <a href="/" className="brand-lockup" aria-label="Fumi Archive home">
          <span className="brand-symbol">ᗜˬᗜ</span>
          <span className="brand-copy">
            <strong>FUMI ARCHIVE</strong>
            <small>ADMINISTRATION NODE</small>
          </span>
        </a>

        <div className="topbar-actions">
          <TacticalBadge variant="warning">ADMIN MODE</TacticalBadge>
          <a className="admin-link admin-link-active" href="/admin/" aria-current="page">
            IMAGES
          </a>
          <a className="admin-link" href="/admin/spots/">
            SPOTS
          </a>
          <a className="admin-link" href="/">
            PUBLIC ARCHIVE
          </a>
        </div>
      </header>

      <main className="admin-main">
        <section className="admin-hero">
          <div>
            <p className="section-kicker">RESTRICTED CONTROL // NODE 01</p>
            <h1>
              <GlitchText intensity="low">MODERATION CONSOLE.</GlitchText>
            </h1>
            <p className="admin-lead">
              Review archive entries, hide or restore images, and test operational
              notifications.
            </p>
          </div>

          <section className="session-panel" aria-label="Admin session">
            <div className="session-panel-header">
              <span>SESSION</span>
              <span className="session-panel-state">
                <i aria-hidden="true" />
                ONLINE
              </span>
            </div>

            <dl className="session-list">
              <div>
                <dt>IDENTITY</dt>
                <dd>{adminEmail}</dd>
              </div>
              <div>
                <dt>ACCESS</dt>
                <dd>CLOUDFLARE ACCESS</dd>
              </div>
              <div>
                <dt>STATE</dt>
                <dd>AUTHORIZED</dd>
              </div>
            </dl>

            <span className="session-panel-corner tl" aria-hidden="true" />
            <span className="session-panel-corner tr" aria-hidden="true" />
            <span className="session-panel-corner bl" aria-hidden="true" />
            <span className="session-panel-corner br" aria-hidden="true" />
          </section>
        </section>

        <section className="admin-stats" aria-label="Moderation statistics">
          <Stat label="TOTAL" value={counts.all} />
          <Stat label="PUBLISHED" value={counts.published} tone="success" />
          <Stat label="HIDDEN" value={counts.hidden} tone="warning" />
        </section>

        <ScanDivider label="MODERATION QUEUE" />

        <section className="admin-controls">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <TabsList variant="bordered">
              <TabsTrigger value="all" variant="bordered">
                ALL // {counts.all}
              </TabsTrigger>
              <TabsTrigger value="published" variant="bordered">
                PUBLISHED // {counts.published}
              </TabsTrigger>
              <TabsTrigger value="hidden" variant="bordered">
                HIDDEN // {counts.hidden}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="admin-actions">
            <Button variant="secondary" size="sm" onClick={() => void loadImages()} loading={loading}>
              REFRESH
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void testNotification()}
              loading={notificationBusy}
            >
              TEST NOTIFICATION
            </Button>
          </div>
        </section>

        {loading ? (
          <div className="admin-grid" aria-label="Loading moderation data">
            {Array.from({ length: 8 }).map((_, index) => (
              <div className="admin-skeleton" key={index} />
            ))}
          </div>
        ) : visibleImages.length === 0 ? (
          <div className="archive-state admin-empty">
            <strong>NO ENTRIES IN THIS VIEW</strong>
            <span>There is nothing to moderate here.</span>
          </div>
        ) : (
          <div className="admin-grid">
            {visibleImages.map((image, index) => (
              <AdminCard
                key={image.id}
                image={image}
                index={index}
                busy={busyId === image.id}
                onToggle={() => void changeStatus(image)}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="site-footer">
        <div>
          <strong>FUMI ARCHIVE // ADMIN</strong>
          <span>RESTRICTED MODERATION INTERFACE</span>
        </div>
        <span>{counts.all} ENTRIES LOADED</span>
      </footer>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone?: "success" | "warning";
}) {
  return (
    <div className={"admin-stat " + (tone ? "admin-stat-" + tone : "")}>
      <span>{label}</span>
      <strong>{String(value).padStart(3, "0")}</strong>
    </div>
  );
}

function AdminCard({
  image,
  index,
  busy,
  onToggle
}: {
  image: AdminImage;
  index: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const [src, setSrc] = useState(image.directUrl);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(image.createdAt));

  function handleError() {
    if (!fallbackUsed && image.srcUrl) {
      setFallbackUsed(true);
      setSrc(image.srcUrl);
    }
  }

  return (
    <article className={"admin-card admin-card-" + image.status}>
      <a href={src} target="_blank" rel="noreferrer" className="admin-image-link">
        <img src={src} alt="" loading="lazy" decoding="async" onError={handleError} />
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <span className="entry-index">#{String(index + 1).padStart(3, "0")}</span>
        <span className={"status-chip status-chip-" + image.status}>{image.status}</span>
      </a>

      <div className="admin-card-body">
        <div className="admin-card-meta">
          <time dateTime={image.createdAt}>{date}</time>
          <span>{formatBytes(image.bytes)}</span>
        </div>

        <div className="admin-card-details">
          <span>{image.mimeType}</span>
          <span>{image.width && image.height ? image.width + "×" + image.height : "SIZE N/A"}</span>
        </div>

        <Button
          variant={image.status === "published" ? "danger" : "secondary"}
          size="sm"
          loading={busy}
          onClick={onToggle}
          className="admin-card-action"
        >
          {image.status === "published" ? "HIDE FROM ARCHIVE" : "RESTORE TO ARCHIVE"}
        </Button>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
