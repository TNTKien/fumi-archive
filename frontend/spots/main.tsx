import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, SonnerToaster, notify } from "reend-components";
import "reend-components/styles.css";
import { SiteHeader } from "../src/site-header";
import "../src/styles.css";
import "./spots.css";

type Spot = {
  id: string;
  displayName: string;
  title: string;
  description?: string | null;
  directUrl: string;
  srcUrl?: string | null;
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
};

type GeoLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  city: string;
  country: string;
  label: string;
  source: "device" | "network";
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

const MAPLIBRE_MODULE =
  "https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs";
const MAX_BYTES = 2 * 1024 * 1024;

function SpotsApp() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<"browse" | "create">("browse");
  const [mapKey, setMapKey] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [uploadAvailability, setUploadAvailability] =
    useState<"checking" | "online" | "offline">("checking");

  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationMode, setLocationMode] =
    useState<"exact" | "approximate" | "city">("approximate");

  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const maplibreRef = useRef<any>(null);
  const spotsRef = useRef<Spot[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const turnstileWidgetRef = useRef<string | null>(null);

  const selectedSpot = useMemo(
    () => spots.find((spot) => spot.id === selectedId) || null,
    [spots, selectedId]
  );

  const previewUrl = useMemo(
    () => (file ? URL.createObjectURL(file) : ""),
    [file]
  );

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    void loadInitialData();
    void requestLocation(false);
    void loadUploadAvailability();
  }, []);

  useEffect(() => {
    if (!mapKey || !mapContainerRef.current || mapRef.current) return;

    let disposed = false;

    async function initMap() {
      try {
        const maplibre = await import(/* @vite-ignore */ MAPLIBRE_MODULE);
        if (disposed || !mapContainerRef.current) return;

        maplibreRef.current = maplibre;
        const map = new maplibre.Map({
          container: mapContainerRef.current,
          center: [18, 22],
          zoom: 1.55,
          minZoom: 1.2,
          style: createNeutralStyle(mapKey),
          attributionControl: false
        });

        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(
          new maplibre.AttributionControl({ compact: true }),
          "bottom-right"
        );

        map.on("load", () => {
          if (disposed) return;
          mapRef.current = map;
          addSpotLayers(map);
          updateSpotSource(map, spotsRef.current);

          map.on("click", "spot-points", (event: any) => {
            const id = event.features?.[0]?.properties?.id;
            if (id) {
              setSelectedId(String(id));
              setPanelMode("browse");
            }
          });

          map.on("mouseenter", "spot-points", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "spot-points", () => {
            map.getCanvas().style.cursor = "";
          });

          setMapReady(true);
        });
      } catch (error) {
        notify.error("Map could not be initialized.", {
          description: error instanceof Error ? error.message : undefined
        });
      }
    }

    void initMap();

    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mapKey]);

  useEffect(() => {
    if (mapReady && mapRef.current) {
      updateSpotSource(mapRef.current, spots);
    }
  }, [spots, mapReady]);

  useEffect(() => {
    if (!mapReady || !location || !mapRef.current) return;
    updateCurrentLocation(mapRef.current, location);

    mapRef.current.flyTo({
      center: [location.longitude, location.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 8),
      duration: 900
    });
  }, [location, mapReady]);

  useEffect(() => {
    if (!turnstileSiteKey || !panelMode || panelMode !== "create") return;

    let cancelled = false;

    async function setupTurnstile() {
      try {
        await loadTurnstileScript();
        if (cancelled || !window.turnstile) return;

        const host = document.querySelector("#spots-turnstile");
        if (!host || host.childElementCount > 0) return;

        turnstileWidgetRef.current = window.turnstile.render(host as HTMLElement, {
          sitekey: turnstileSiteKey,
          action: "spot",
          theme: "dark",
          size: window.matchMedia("(max-width: 360px)").matches ? "compact" : "flexible",
          callback: setTurnstileToken,
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => {
            setTurnstileToken("");
            notify.error("Verification failed to initialize.");
          }
        });
      } catch {
        notify.error("Verification is unavailable.");
      }
    }

    void setupTurnstile();
    return () => {
      cancelled = true;
    };
  }, [turnstileSiteKey, panelMode]);

  async function loadUploadAvailability() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        throw new Error("Status unavailable");
      }

      setUploadAvailability(body.uploadAvailable ? "online" : "offline");
    } catch {
      setUploadAvailability("offline");
    }
  }

  async function loadInitialData() {
    try {
      const [configResponse, spotsResponse] = await Promise.all([
        fetch("/api/spots/config", { cache: "no-store" }),
        fetch("/api/spots?limit=500", { cache: "no-store" })
      ]);

      const config = await configResponse.json().catch(() => ({}));
      const spotBody = await spotsResponse.json().catch(() => ({}));

      if (configResponse.ok && config.success !== false) {
        setMapKey(config.protomapsApiKey || "");
        setTurnstileSiteKey(config.turnstileSiteKey || "");
      }

      if (!spotsResponse.ok || spotBody.success === false) {
        throw new Error(spotBody.error || "Could not load spots.");
      }

      setSpots(spotBody.spots || []);
      setTotal(Number(spotBody.total) || 0);
      if (spotBody.spots?.length) setSelectedId(spotBody.spots[0].id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Could not load spots.");
    }
  }

  async function requestLocation(showError = true) {
    if (!navigator.geolocation) {
      const message = "Geolocation is not supported by this browser.";
      setLocationError(message);
      if (showError) notify.error(message);
      return;
    }

    setLocationLoading(true);
    setLocationError("");

    try {
      let position: GeolocationPosition;

      try {
        position = await getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0
        });
      } catch (error) {
        const geoError = error as GeolocationPositionError;

        if (geoError.code === geoError.PERMISSION_DENIED) {
          throw error;
        }

        position = await getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 300000
        });
      }

      const base = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };

      try {
        const params = new URLSearchParams({
          latitude: String(base.latitude),
          longitude: String(base.longitude),
          localityLanguage: "en"
        });
        const response = await fetch(
          "https://api.bigdatacloud.net/data/reverse-geocode-client?" + params,
          { signal: AbortSignal.timeout(8000) }
        );

        if (!response.ok) throw new Error("Reverse geocoding failed.");

        const body = await response.json();
        const city = body.city || body.principalSubdivision || "";
        const country = body.countryName || "";
        const label = [city, country].filter(Boolean).join(", ") || "Current location";

        setLocation({ ...base, city, country, label, source: "device" });
      } catch {
        setLocation({
          ...base,
          city: "",
          country: "",
          label: "Current location",
          source: "device"
        });
      }

      setLocationError("");
    } catch (error) {
      const geoError = error as Partial<GeolocationPositionError>;

      if (geoError.code !== 1) {
        try {
          const fallback = await loadNetworkLocation();

          if (fallback) {
            setLocation(fallback);
            setLocationError("Using approximate network location because device location is unavailable.");

            if (locationMode === "exact") {
              setLocationMode("approximate");
            }

            if (showError) {
              notify.info("Using approximate network location.", {
                description:
                  "Desktop device location timed out, so Fumi Spots is using Cloudflare network geolocation."
              });
            }

            return;
          }
        } catch {
          // Fall through to the original geolocation error.
        }
      }

      setLocation(null);
      const message = describeGeolocationError(error);
      setLocationError(message);

      if (showError) {
        notify.error("Could not determine your current location.", {
          description: message
        });
      }
    } finally {
      setLocationLoading(false);
    }
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    if (next.type !== "image/jpeg" && next.type !== "image/png") {
      notify.error("Only JPEG and PNG images are supported.");
      return;
    }
    if (next.size <= 0 || next.size > MAX_BYTES) {
      notify.error("Image must be 2 MB or smaller.");
      return;
    }
    setFile(next);
  }

  async function createSpot(event: React.FormEvent) {
    event.preventDefault();

    if (!location) {
      notify.error("Current location is required.");
      return;
    }

    if (locationMode === "exact" && location.source !== "device") {
      notify.error("Exact location requires device geolocation.", {
        description: "Use Approximate/City only, or enable desktop location services."
      });
      return;
    }

    if (locationMode === "city" && !location.city) {
      notify.error("City could not be detected. Retry location or choose another privacy mode.");
      return;
    }

    if (!file || !displayName.trim() || !title.trim() || !turnstileToken) {
      notify.error("Complete all required fields and verification.");
      return;
    }

    setSubmitting(true);

    try {
      const form = new FormData();
      form.append("displayName", displayName.trim());
      form.append("title", title.trim());
      form.append("description", description.trim());
      form.append("locationMode", locationMode);
      form.append("locationSource", location.source);
      form.append("latitude", String(location.latitude));
      form.append("longitude", String(location.longitude));
      form.append("city", location.city);
      form.append("country", location.country);
      form.append("file", file);
      form.append("cf-turnstile-response", turnstileToken);

      const response = await fetch("/api/spots", {
        method: "POST",
        body: form
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok || body.success === false) {
        throw new Error(body.error || "Could not create spot.");
      }

      const spot = body.spot as Spot;
      setSpots((current) => [spot, ...current]);
      setTotal((current) => current + 1);
      setSelectedId(spot.id);
      setPanelMode("browse");
      setTitle("");
      setDescription("");
      setFile(null);

      notify.success("Spot created.", {
        description: "Your Fumo is now on the map."
      });

      mapRef.current?.flyTo({
        center: [spot.longitude, spot.latitude],
        zoom: Math.max(mapRef.current.getZoom(), 9),
        duration: 900
      });
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "Could not create spot.");
    } finally {
      setSubmitting(false);
      setTurnstileToken("");
      if (window.turnstile && turnstileWidgetRef.current) {
        window.turnstile.reset(turnstileWidgetRef.current);
      }
    }
  }

  function focusSpot(spot: Spot) {
    setSelectedId(spot.id);
    setPanelMode("browse");
    mapRef.current?.flyTo({
      center: [spot.longitude, spot.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 8),
      duration: 700
    });
  }

  return (
    <>
      <SonnerToaster position="top-right" />
      <div className="spots-shell">
        <SiteHeader
          uploadAvailability={uploadAvailability}
          current="spots"
        />

        <div className="spots-layout">
          <aside className="spots-sidebar">
            <div className="spots-tabs">
              <button
                type="button"
                className={panelMode === "browse" ? "active" : ""}
                onClick={() => setPanelMode("browse")}
              >
                BROWSE
              </button>
              <button
                type="button"
                className={panelMode === "create" ? "active" : ""}
                onClick={() => setPanelMode("create")}
              >
                + NEW SPOT
              </button>
            </div>

            {panelMode === "create" ? (
              <form className="spot-form" onSubmit={createSpot}>
                <div className="spot-form-intro">
                  <span>CREATE SPOT</span>
                  <p>
                    Add one Fumo photo at your current location. Approximate is the
                    default privacy mode.
                  </p>
                </div>

                <Field label="DISPLAY NAME" required>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    minLength={2}
                    maxLength={40}
                    placeholder="How should we credit you?"
                    required
                  />
                </Field>

                <Field label="TITLE" required>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    minLength={2}
                    maxLength={100}
                    placeholder="Reimu at the coffee shop"
                    required
                  />
                </Field>

                <Field label="DESCRIPTION" hint="OPTIONAL">
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder="What happened here?"
                  />
                </Field>

                <div className="spot-field">
                  <div className="spot-field-label">
                    <span>PHOTO *</span>
                    <span>JPEG / PNG · 2 MB</span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      chooseFile(event.target.files?.[0] || null);
                      event.currentTarget.value = "";
                    }}
                  />

                  <div
                    className={"spot-dropzone" + (dragActive ? " is-dragging" : "")}
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      chooseFile(event.dataTransfer.files?.[0] || null);
                    }}
                  >
                    {file ? (
                      <>
                        <img src={previewUrl} alt="" />
                        <div>
                          <strong>{file.name}</strong>
                          <span>{formatBytes(file.size)} · CLICK TO REPLACE</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="spot-drop-icon">◇</span>
                        <div>
                          <strong>DROP IMAGE HERE</strong>
                          <span>OR CLICK TO SELECT</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="spot-field">
                  <div className="spot-field-label">
                    <span>CURRENT LOCATION *</span>
                    <button
                      type="button"
                      onClick={() => void requestLocation(true)}
                      disabled={locationLoading}
                    >
                      {locationLoading ? "LOCATING…" : "REFRESH"}
                    </button>
                  </div>

                  <div className={"location-readout" + (location ? " ready" : "")}>
                    <span className="location-dot" />
                    <div>
                      <strong>
                        {locationLoading
                          ? "LOCATING…"
                          : location?.label || "LOCATION NOT AVAILABLE"}
                      </strong>
                      <span>
                        {location
                          ? location.source === "device"
                            ? "Device location · accuracy ±" + Math.round(location.accuracy || 0) + " m"
                            : "Approximate network location"
                          : locationError || "Allow location access to create a spot."}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="spot-field">
                  <div className="spot-field-label">
                    <span>LOCATION PRIVACY *</span>
                    <span>DEFAULT: APPROXIMATE</span>
                  </div>

                  <div className="privacy-options">
                    <PrivacyOption
                      value="exact"
                      current={locationMode}
                      onChange={setLocationMode}
                      title="EXACT"
                      description={
                        location?.source === "network"
                          ? "Requires device geolocation."
                          : "Publish the GPS position."
                      }
                      disabled={location?.source === "network"}
                    />
                    <PrivacyOption
                      value="approximate"
                      current={locationMode}
                      onChange={setLocationMode}
                      title="APPROXIMATE"
                      description="Snap to roughly a 500 m grid."
                    />
                    <PrivacyOption
                      value="city"
                      current={locationMode}
                      onChange={setLocationMode}
                      title="CITY ONLY"
                      description="Keep only a coarse city-level area."
                    />
                  </div>
                </div>

                <div className="spot-field">
                  <div className="spot-field-label">
                    <span>HUMAN VERIFICATION *</span>
                    <Badge variant={turnstileToken ? "success" : "default"}>
                      {turnstileToken ? "READY" : "WAITING"}
                    </Badge>
                  </div>
                  <div id="spots-turnstile" className="spots-turnstile" />
                </div>

                {submitting && (
                  <div className="spot-submit-progress">
                    <div>
                      <span>CREATING SPOT</span>
                      <span>TRANSMITTING</span>
                    </div>
                    <div><span /></div>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="spot-submit"
                  loading={submitting}
                  disabled={
                    submitting ||
                    !location ||
                    !file ||
                    !displayName.trim() ||
                    !title.trim() ||
                    !turnstileToken
                  }
                >
                  CREATE SPOT
                </Button>
              </form>
            ) : (
              <div className="spots-browser">
                {selectedSpot ? (
                  <SpotDetail spot={selectedSpot} />
                ) : (
                  <div className="spots-empty">SELECT A SPOT ON THE MAP</div>
                )}

                <div className="recent-heading">
                  <span>LATEST SPOTS</span>
                  <span>{spots.length} LOADED</span>
                </div>

                <div className="recent-spots">
                  {spots.map((spot) => (
                    <button
                      type="button"
                      className={"recent-spot" + (spot.id === selectedId ? " active" : "")}
                      key={spot.id}
                      onClick={() => focusSpot(spot)}
                    >
                      <img src={spot.directUrl} alt="" loading="lazy" />
                      <div>
                        <strong>{spot.title}</strong>
                        <span>{spot.locationName || "Mapped location"}</span>
                        <small>BY {spot.displayName}</small>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <section className="spots-map-wrap">
            <div ref={mapContainerRef} className="spots-map" />
            {!mapKey && (
              <div className="map-config-missing">
                <strong>MAP KEY REQUIRED</strong>
                <span>Configure PROTOMAPS_API_KEY to load the basemap.</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  hint,
  required,
  children
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="spot-field">
      <span className="spot-field-label">
        <span>{label}{required ? " *" : ""}</span>
        {hint && <span>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function PrivacyOption({
  value,
  current,
  onChange,
  title,
  description,
  disabled = false
}: {
  value: "exact" | "approximate" | "city";
  current: "exact" | "approximate" | "city";
  onChange: (value: "exact" | "approximate" | "city") => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={
        "privacy-option" +
        (current === value ? " active" : "") +
        (disabled ? " disabled" : "")
      }
    >
      <input
        type="radio"
        name="location-mode"
        value={value}
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span className="privacy-radio" />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function SpotDetail({ spot }: { spot: Spot }) {
  return (
    <article className="spot-detail">
      <div className="spot-detail-image">
        <img src={spot.directUrl} alt="" />
        <Badge variant="success">{spot.locationMode.toUpperCase()}</Badge>
      </div>
      <div className="spot-detail-body">
        <span className="spot-detail-location">
          {spot.locationName || "Mapped location"}
        </span>
        <h1>{spot.title}</h1>
        {spot.description && <p>{spot.description}</p>}
        <div className="spot-detail-meta">
          <span>BY {spot.displayName}</span>
          <time dateTime={spot.createdAt}>{formatDate(spot.createdAt)}</time>
        </div>
      </div>
    </article>
  );
}

function createNeutralStyle(apiKey: string) {
  const source = "protomaps";

  return {
    version: 8,
    glyphs:
      "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: {
      [source]: {
        type: "vector",
        tiles: [
          "https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=" +
            encodeURIComponent(apiKey)
        ],
        maxzoom: 15,
        attribution:
          "© OpenStreetMap contributors · Protomaps"
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0b0e10" }
      },
      {
        id: "earth",
        type: "fill",
        source,
        "source-layer": "earth",
        paint: { "fill-color": "#171c1e" }
      },
      {
        id: "landcover",
        type: "fill",
        source,
        "source-layer": "landcover",
        paint: {
          "fill-color": [
            "match",
            ["get", "kind"],
            "forest", "#152019",
            "grassland", "#182119",
            "glacier", "#273134",
            "urban_area", "#1b1d1e",
            "#181b1c"
          ],
          "fill-opacity": 0.72
        }
      },
      {
        id: "water",
        type: "fill",
        source,
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#101b22" }
      },
      {
        id: "roads",
        type: "line",
        source,
        "source-layer": "roads",
        paint: {
          "line-color": "#343a3c",
          "line-opacity": 0.72,
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            4, 0.2,
            9, 0.8,
            14, 2.2
          ]
        }
      },
      {
        id: "buildings",
        type: "fill",
        source,
        "source-layer": "buildings",
        minzoom: 13,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#252a2c",
          "fill-outline-color": "#303638"
        }
      },
      {
        id: "country-labels",
        type: "symbol",
        source,
        "source-layer": "places",
        minzoom: 1,
        maxzoom: 6,
        filter: ["==", ["get", "kind"], "country"],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 5, 14],
          "text-letter-spacing": 0.08
        },
        paint: {
          "text-color": "#747d80",
          "text-halo-color": "#0b0e10",
          "text-halo-width": 1.5
        }
      },
      {
        id: "locality-labels",
        type: "symbol",
        source,
        "source-layer": "places",
        minzoom: 4,
        filter: ["==", ["get", "kind"], "locality"],
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": [
            "interpolate", ["linear"], ["zoom"],
            4, 9,
            8, 12,
            13, 15
          ],
          "text-variable-anchor": ["top", "bottom", "left", "right"],
          "text-radial-offset": 0.4
        },
        paint: {
          "text-color": "#929a9c",
          "text-halo-color": "#0b0e10",
          "text-halo-width": 1.5
        }
      }
    ]
  } as any;
}

function addSpotLayers(map: any) {
  map.addSource("fumi-spots", {
    type: "geojson",
    data: spotFeatureCollection([])
  });

  map.addLayer({
    id: "spot-halo",
    type: "circle",
    source: "fumi-spots",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 5, 10, 8],
      "circle-color": "rgba(81,216,138,.16)",
      "circle-stroke-color": "rgba(81,216,138,.2)",
      "circle-stroke-width": 5
    }
  });

  map.addLayer({
    id: "spot-points",
    type: "circle",
    source: "fumi-spots",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 10, 5],
      "circle-color": "#51d88a",
      "circle-stroke-color": "#08100b",
      "circle-stroke-width": 1.5
    }
  });

  map.addSource("current-location", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: []
    }
  });

  map.addLayer({
    id: "current-location",
    type: "circle",
    source: "current-location",
    paint: {
      "circle-radius": 7,
      "circle-color": "#f5d90a",
      "circle-stroke-color": "#0b0e10",
      "circle-stroke-width": 3
    }
  });
}

function updateSpotSource(map: any, spots: Spot[]) {
  const source = map.getSource("fumi-spots");
  if (source) source.setData(spotFeatureCollection(spots));
}

function updateCurrentLocation(map: any, location: GeoLocation) {
  const source = map.getSource("current-location");
  if (!source) return;

  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [location.longitude, location.latitude]
        },
        properties: {}
      }
    ]
  });
}

function spotFeatureCollection(spots: Spot[]) {
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [spot.longitude, spot.latitude]
      },
      properties: { id: spot.id }
    }))
  };
}

async function loadNetworkLocation(): Promise<GeoLocation | null> {
  const response = await fetch("/api/spots/location-fallback", {
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.success === false || !body.location) {
    return null;
  }

  const countryCode = String(body.location.countryCode || "");
  let country = countryCode;

  try {
    country =
      new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ||
      countryCode;
  } catch {
    // Keep the country code if Intl.DisplayNames is unavailable.
  }

  const city = String(body.location.city || body.location.region || "");
  const label = [city, country].filter(Boolean).join(", ") || "Approximate location";

  return {
    latitude: Number(body.location.latitude),
    longitude: Number(body.location.longitude),
    accuracy: null,
    city,
    country,
    label,
    source: "network"
  };
}

function getCurrentPosition(
  options: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function describeGeolocationError(error: unknown) {
  const geoError = error as Partial<GeolocationPositionError>;

  if (geoError.code === 1) {
    return "Location permission is blocked. Allow location for this site and try again.";
  }

  if (geoError.code === 2) {
    return "Your device/browser could not determine a position. Check system location services or network access.";
  }

  if (geoError.code === 3) {
    return "Location lookup timed out. Check system location services and try Refresh.";
  }

  return error instanceof Error && error.message
    ? error.message
    : "Location is currently unavailable.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
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
      existing.addEventListener("error", () => reject(new Error("Turnstile failed.")), {
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
    script.onerror = () => reject(new Error("Turnstile failed."));
    document.head.appendChild(script);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SpotsApp />
  </React.StrictMode>
);
