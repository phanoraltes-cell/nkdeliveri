import { useQuery } from "@tanstack/react-query";
import { geocodeAddress, reverseGeocode } from "@/services/geocoding";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Address -> coordinates, cached both in TanStack Query and services/geocoding's own localStorage cache. */
export function useGeocodeAddress(address: string | undefined) {
  return useQuery({
    queryKey: ["geocode", address?.trim().toLowerCase()],
    queryFn: () => geocodeAddress(address!),
    enabled: !!address && address.trim().length > 3,
    staleTime: DAY_MS,
    retry: 1,
  });
}

/** Coordinates -> a human-readable address. */
export function useReverseGeocode(lat: number | undefined, lng: number | undefined) {
  return useQuery({
    queryKey: ["reverse-geocode", lat?.toFixed(5), lng?.toFixed(5)],
    queryFn: () => reverseGeocode(lat!, lng!),
    enabled: lat != null && lng != null,
    staleTime: DAY_MS,
    retry: 1,
  });
}
