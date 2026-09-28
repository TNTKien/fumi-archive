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
import "../../src/styles.css";
import "../admin.css";

type AdminSpot = {
  id: string;
  displayName: string;
  title: string;
  description?: string | null;
  directUrl: string;
  srcUrl?: string | null;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  latitude: number;
  longitude: number;
  locationMode: "exact" | "approximate" | "city";
  locationName?: string | null;
  city?: string | null;
  country?: string | null;
  createdAt: string;
  status: "published" | "hidden";
};

type Filter = "all" | "published" | "hidden";

function AdminSpotsApp() {
  const [spots, setSpots] = useState<AdminSpot[]>([]);
  const [adminEmail, setAdminEmail] = useState("Authenticated admin");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const published = spots.filter((spot) => spot.status === "published").length;
    const hidden = spots.filter((spot) => spot.status === "hidden").length;
    return { all: spots.length, published, hidden };
  }, [spots]);

  const visibleSpots = useMemo(() => {
    if (filter === "all") return spots;
    return spots.filter((spot) => spot.status === filter);
  }, [filter, spots]);

  useEffect(() => {
    void loadSpots();
  }, []);

  async function loadSpots() {
    setLoading(true);

    try {
      const params = new URLSearchParams({ limit: "200", status: "all" });
      const response = await fetch("/api/admin/spots?" + params.toString(), {
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        throw new Error(body.error || "Could not load spot moderation data.");
      }

      setSpots(body.spots || []);
      setAdminEmail(body.admin || "Authenticated admin");
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : "Could not load spot moderation data.",
        { duration: 5000 }
      );
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(spot: AdminSpot) {
    const nextStatus = spot.status === "published" ? "hidden" : "published";
    setBusyId(spot.id);

    try {
      const response = await fetch(
        "/api/admin/spots/" + encodeURIComponent(spot.id) + "/status",
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

      setSpots((current) =>
        current.map((item) =>
          item.id === spot.id ? { ...item, status: nextStatus } : item
        )
      );

      notify.success(
        nextStatus === "hidden"
          ? "Spot hidden from the public map."
          : "Spot restored to the public map.",
        {
          description:
            nextStatus === "hidden"
              ? "It will no longer appear in Fumi Spots."
              : "It is visible in Fumi Spots again."
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
            <a className="admin-link" href="/admin/">
              IMAGES
            </a>
            <a className="admin-link admin-link-active" href="/admin/spots/" aria-current="page">
              SPOTS
            </a>
            <a className="admin-link" href="/spots/">
              PUBLIC SPOTS
            </a>
          </div>
        </header>

        <main className="admin-main">
          <section className="admin-hero">
            <div>
              <p className="section-kicker">RESTRICTED CONTROL // SPOTS</p>
              <h1>
                <GlitchText intensity="low">SPOT MODERATION.</GlitchText>
              </h1>
              <p className="admin-lead">
                Review Fumi Spots and hide or restore entries on the public map.
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
                  <dt>RESOURCE</dt>
                  <dd>FUMI SPOTS</dd>
                </div>
              </dl>

              <span className="session-panel-corner tl" aria-hidden="true" />
              <span className="session-panel-corner tr" aria-hidden="true" />
              <span className="session-panel-corner bl" aria-hidden="true" />
              <span className="session-panel-corner br" aria-hidden="true" />
            </section>
          </section>

          <section className="admin-stats" aria-label="Spot moderation statistics">
            <Stat label="TOTAL" value={counts.all} />
            <Stat label="PUBLISHED" value={counts.published} tone="success" />
            <Stat label="HIDDEN" value={counts.hidden} tone="warning" />
          </section>

          <ScanDivider label="SPOT MODERATION QUEUE" />

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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadSpots()}
                loading={loading}
              >
                REFRESH
              </Button>
            </div>
          </section>

          {loading ? (
            <div className="admin-grid" aria-label="Loading spot moderation data">
              {Array.from({ length: 8 }).map((_, index) => (
                <div className="admin-skeleton" key={index} />
              ))}
            </div>
          ) : visibleSpots.length === 0 ? (
            <div className="archive-state admin-empty">
              <strong>NO SPOTS IN THIS VIEW</strong>
              <span>There is nothing to moderate here.</span>
            </div>
          ) : (
            <div className="admin-grid">
              {visibleSpots.map((spot, index) => (
                <AdminSpotCard
                  key={spot.id}
                  spot={spot}
                  index={index}
                  busy={busyId === spot.id}
                  onToggle={() => void changeStatus(spot)}
                />
              ))}
            </div>
          )}
        </main>

        <footer className="site-footer">
          <div>
            <strong>FUMI ARCHIVE // ADMIN</strong>
            <span>RESTRICTED SPOT MODERATION INTERFACE</span>
          </div>
          <span>{counts.all} SPOTS LOADED</span>
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

function AdminSpotCard({
  spot,
  index,
  busy,
  onToggle
}: {
  spot: AdminSpot;
  index: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const [src, setSrc] = useState(spot.directUrl);
  const [fallbackUsed, setFallbackUsed] = useState(false);

  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(spot.createdAt));

  function handleError() {
    if (!fallbackUsed && spot.srcUrl) {
      setFallbackUsed(true);
      setSrc(spot.srcUrl);
    }
  }

  return (
    <article className={"admin-card admin-card-" + spot.status}>
      <a href={src} target="_blank" rel="noreferrer" className="admin-image-link">
        <img src={src} alt="" loading="lazy" decoding="async" onError={handleError} />
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <span className="entry-index">#{String(index + 1).padStart(3, "0")}</span>
        <span className={"status-chip status-chip-" + spot.status}>{spot.status}</span>
      </a>

      <div className="admin-card-body admin-spot-card-body">
        <strong className="admin-spot-title">{spot.title}</strong>
        <span className="admin-spot-by">BY {spot.displayName}</span>

        <div className="admin-card-meta">
          <time dateTime={spot.createdAt}>{date}</time>
          <span>{formatBytes(spot.bytes)}</span>
        </div>

        <div className="admin-spot-location">
          <span>{spot.locationName || "Mapped location"}</span>
          <span>{spot.locationMode.toUpperCase()}</span>
        </div>

        <Button
          variant={spot.status === "published" ? "danger" : "secondary"}
          size="sm"
          loading={busy}
          onClick={onToggle}
          className="admin-card-action"
        >
          {spot.status === "published" ? "HIDE FROM SPOTS" : "RESTORE TO SPOTS"}
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
    <AdminSpotsApp />
  </React.StrictMode>
);
