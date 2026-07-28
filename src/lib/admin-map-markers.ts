import type { MapMarker } from "@/components/maps/LeafletMap";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";
import { DELIVERY_STATUS_LABEL } from "@/lib/delivery-status";

type RestaurantRow = {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
};
type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  current_lat: number | null;
  current_lng: number | null;
};

/**
 * Pure derivation of every marker on the admin live map (restaurant/driver/
 * client pins), extracted verbatim from dashboard.admin.index.tsx — this
 * was already flagged there as the heaviest per-render work on the page
 * (it feeds LeafletMap, which reconciles markers on every prop change), so
 * it stays wrapped in useMemo at the call site rather than gaining its own
 * memoization here.
 */
export function buildAdminMapMarkers(
  filteredRestaurants: RestaurantRow[],
  onlineDrivers: DriverRow[],
  filteredActive: ActiveDelivery[],
  active: ActiveDelivery[],
): MapMarker[] {
  return [
    ...filteredRestaurants
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({
        id: `rst-${r.id}`,
        lat: Number(r.lat),
        lng: Number(r.lng),
        type: "restaurant" as const,
        label: r.name ?? "Restoran",
        info: { title: r.name ?? "Restoran", lines: [r.address ?? ""] },
      })),
    ...onlineDrivers
      .filter((d) => d.current_lat != null && d.current_lng != null)
      .map((d) => {
        const busy = active.some((a) => a.driver_id === d.id);
        const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Livrè";
        return {
          id: `drv-${d.id}`,
          lat: Number(d.current_lat),
          lng: Number(d.current_lng),
          type: "driver" as const,
          label: name,
          info: { title: name, lines: [`Estati: ${busy ? "An liv rezon" : "Disponib"}`] },
        };
      }),
    ...filteredActive
      .filter(
        (d) =>
          d.customer_location || (d.order?.delivery_lat != null && d.order?.delivery_lng != null),
      )
      .map((d) => {
        const address = d.order?.delivery_address ?? "—";
        const phone = d.order?.contact_phone ?? "—";
        const orderNumber = d.order?.order_number ?? "";
        // Prefer the customer's live shared position (Phase 1 GPS sharing)
        // over their registered delivery address, same preference order as
        // the customer/driver views.
        const lat = d.customer_location ? d.customer_location.lat : d.order!.delivery_lat!;
        const lng = d.customer_location ? d.customer_location.lng : d.order!.delivery_lng!;
        return {
          id: `dst-${d.id}`,
          lat: Number(lat),
          lng: Number(lng),
          type: "client" as const,
          label: `Adrès ${d.order?.order_number}`,
          info: {
            title: `Kòmand ${orderNumber}${d.customer_location ? " — pozisyon an tan reyèl" : ""}`,
            lines: [
              `Adrès: ${address}`,
              `Telefòn: ${phone}`,
              `Estati: ${DELIVERY_STATUS_LABEL[d.status] ?? d.status}`,
            ],
          },
        };
      }),
  ];
}
