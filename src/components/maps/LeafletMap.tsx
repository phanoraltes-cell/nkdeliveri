import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AlertTriangle, WifiOff } from "lucide-react";

export type MarkerType = "client" | "restaurant" | "driver" | "order";

/** Popup content shown when a marker is clicked — plain text only (no HTML
 * parsing), so callers never need to think about escaping untrusted text. */
export type MapPopupInfo = {
  title?: string;
  lines?: string[];
};

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  type: MarkerType;
  label?: string;
  info?: MapPopupInfo;
};

const TYPE_COLOR: Record<MarkerType, string> = {
  client: "#3b82f6", // blue
  restaurant: "#f97316", // orange (brand)
  driver: "#10b981", // green
  order: "#ef4444", // red
};

const iconCache = new Map<MarkerType, L.DivIcon>();
function getIcon(type: MarkerType): L.DivIcon {
  const cached = iconCache.get(type);
  if (cached) return cached;
  const color = TYPE_COLOR[type];
  const icon = L.divIcon({
    className: "nk-map-marker",
    html: `<span style="display:block;width:20px;height:20px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
  iconCache.set(type, icon);
  return icon;
}

const GONAIVES_CENTER: [number, number] = [19.4515, -72.6836];

/** Imperatively re-centers/fits the map when markers change, without remounting the MapContainer. */
function MapUpdater({
  markers,
  center,
}: {
  markers: MapMarker[];
  center?: { lat: number; lng: number };
}) {
  const map = useMap();
  const lastKeyRef = useRef<string>("");

  const key = center
    ? `c:${center.lat},${center.lng}`
    : markers.map((m) => `${m.id}:${m.lat},${m.lng}`).join("|");

  if (key !== lastKeyRef.current) {
    lastKeyRef.current = key;
    if (center) {
      map.panTo([center.lat, center.lng]);
    } else if (markers.length > 1) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [60, 60] });
    } else if (markers.length === 1) {
      map.panTo([markers[0].lat, markers[0].lng]);
    }
  }
  return null;
}

/** Disables scroll-wheel zoom by default so the map doesn't hijack page scroll.
 *  Enables it only after the user clicks the map, and disables again on mouse-out.
 *  Also adds zoom control at bottomright so it isn't clipped by overflow-hidden + rounded corners. */
function ScrollWheelToggle() {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.disable();

    // Add zoom control at bottomright to avoid being clipped at top by overflow-hidden + border-radius
    const zoomCtrl = L.control.zoom({ position: "bottomright" });
    zoomCtrl.addTo(map);

    const enableZoom = () => map.scrollWheelZoom.enable();
    const disableZoom = () => map.scrollWheelZoom.disable();

    map.on("click", enableZoom);
    map.on("mouseout", disableZoom);

    return () => {
      map.off("click", enableZoom);
      map.off("mouseout", disableZoom);
      zoomCtrl.remove();
    };
  }, [map]);

  return null;
}

export type MapRoute = {
  id: string;
  path: [number, number][];
  color?: string;
};

export function LeafletMap({
  markers,
  center,
  zoom = 13,
  className,
  route,
  routes,
}: {
  markers: MapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
  /** Optional single driving route polyline (as returned by useRoute/services/routing). */
  route?: [number, number][];
  /** Optional multiple named routes (e.g. one per active delivery on the admin map). */
  routes?: MapRoute[];
}) {
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [tilesError, setTilesError] = useState(false);

  const initialCenter = useMemo<[number, number]>(() => {
    if (center) return [center.lat, center.lng];
    if (markers[0]) return [markers[0].lat, markers[0].lng];
    return GONAIVES_CENTER;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only used for the initial mount

  const boxClassName =
    className || "h-[400px] w-full rounded-2xl border border-brand-soft/60 bg-brand-soft/20";

  return (
    // isolate: Leaflet's own stylesheet gives its internal panes/controls/
    // popups z-index up to 1000 (.leaflet-top/.leaflet-bottom). This div has
    // `relative` but no z-index of its own, so — without isolation — those
    // values aren't scoped to the map's box; they compare directly against
    // the rest of the page's stacking contexts. Since the dashboard header
    // (sticky, z-40) and the public site header/bottom-nav (z-50) are both
    // well under 1000, whenever the map's box scrolls to overlap them, the
    // map's internal layers would paint on top of "sticky" chrome instead of
    // staying beneath it. `isolate` seals all of Leaflet's z-index values
    // inside this box so they can never escape past its own (unset → 0)
    // stacking position, regardless of scroll offset or viewport size.
    <div
      className={`relative isolate overflow-hidden ${boxClassName}`}
      style={{ touchAction: "pan-y" }}
    >
      <MapContainer
        center={initialCenter}
        zoom={zoom}
        className="h-full w-full"
        zoomControl={false}
        scrollWheelZoom={false}
        style={{ background: "#FED7AA20" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          eventHandlers={{
            load: () => setTilesLoaded(true),
            tileerror: () => setTilesError(true),
          }}
        />
        <MapUpdater markers={markers} center={center} />
        <ScrollWheelToggle />
        {route && route.length > 1 && (
          <Polyline
            positions={route}
            pathOptions={{ color: "#F97316", weight: 4, opacity: 0.85 }}
          />
        )}
        {routes?.map(
          (r) =>
            r.path.length > 1 && (
              <Polyline
                key={r.id}
                positions={r.path}
                pathOptions={{ color: r.color ?? "#F97316", weight: 3, opacity: 0.7 }}
              />
            ),
        )}
        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={getIcon(m.type)}>
            {(m.info || m.label) && (
              <Popup>
                {m.info ? (
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {m.info.title && <b>{m.info.title}</b>}
                    {m.info.lines?.map((line, i) => (
                      <span key={i}>
                        <br />
                        {line}
                      </span>
                    ))}
                  </div>
                ) : (
                  m.label
                )}
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>

      {!tilesLoaded && !tilesError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-brand-soft/20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      )}
      {tilesError && (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs font-semibold text-amber-800 shadow-md">
          <WifiOff className="h-3.5 w-3.5 shrink-0" /> Koneksyon fèb — kat la ka pa parèt konplè.
        </div>
      )}
      {markers.length === 0 && !route && !routes?.length && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink-soft shadow">
          <AlertTriangle className="h-3.5 w-3.5" /> Pa gen pozisyon pou montre kounye a
        </div>
      )}
    </div>
  );
}
