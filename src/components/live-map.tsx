import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  color?: "orange" | "green" | "blue" | "red";
};

const COLOR_HEX: Record<NonNullable<MapMarker["color"]>, string> = {
  orange: "#f97316",
  green: "#10b981",
  blue: "#3b82f6",
  red: "#ef4444",
};

export function LiveMap({
  markers,
  center,
  zoom = 13,
  className,
}: {
  markers: MapMarker[];
  center?: { lat: number; lng: number };
  zoom?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());

  // init
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !ref.current) return;
        const c =
          center ||
          (markers[0] && { lat: markers[0].lat, lng: markers[0].lng }) ||
          { lat: 19.4515, lng: -72.6836 }; // Gonaïves
        mapRef.current = new maps.Map(ref.current, {
          center: c,
          zoom,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
          ],
        });
      })
      .catch((err) => console.error("[LiveMap]", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const g = window.google.maps;
    const seen = new Set<string>();
    const bounds = new g.LatLngBounds();

    markers.forEach((m) => {
      seen.add(m.id);
      const pos = { lat: m.lat, lng: m.lng };
      const color = COLOR_HEX[m.color || "orange"];
      let mk = markersRef.current.get(m.id);
      if (!mk) {
        mk = new g.Marker({
          map,
          position: pos,
          title: m.label,
          icon: {
            path: g.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 3,
          },
        });
        markersRef.current.set(m.id, mk);
      } else {
        mk.setPosition(pos);
        mk.setIcon({
          path: g.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 3,
        });
      }
      bounds.extend(pos);
    });

    // remove stale
    for (const [id, mk] of markersRef.current) {
      if (!seen.has(id)) {
        mk.setMap(null);
        markersRef.current.delete(id);
      }
    }

    if (markers.length > 1) {
      map.fitBounds(bounds, 60);
    } else if (markers.length === 1) {
      map.panTo({ lat: markers[0].lat, lng: markers[0].lng });
    }
  }, [markers]);

  return (
    <div
      ref={ref}
      className={
        className ||
        "h-[400px] w-full rounded-2xl border border-brand-soft/60 bg-brand-soft/20"
      }
    />
  );
}