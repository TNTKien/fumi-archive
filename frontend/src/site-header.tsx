import React from "react";

export type UploadAvailability = "checking" | "online" | "offline";

export function SiteHeader({
  uploadAvailability,
  current
}: {
  uploadAvailability: UploadAvailability;
  current: "archive" | "spots";
}) {
  return (
    <header className="site-header">
      <div className="site-header-left">
        <a href="/" className="site-header-logo" aria-label="Fumi Archive home">
          <span className="brand-symbol">ᗜˬᗜ</span>
        </a>

        <nav className="site-header-nav" aria-label="Primary navigation">
          <a href="/" aria-current={current === "archive" ? "page" : undefined}>
            FUMI ARCHIVE
          </a>
          <a href="/spots/" aria-current={current === "spots" ? "page" : undefined}>
            FUMI SPOTS
          </a>
        </nav>
      </div>

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
  );
}
