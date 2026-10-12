import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as Location from 'expo-location';

// Customer's active location for restaurant discovery/menu comparison --
// mirrors CartContext.tsx's pattern (plain in-memory state, not persisted
// across app restarts: re-asking for GPS or a saved city on each launch is
// the normal, expected flow for a location-aware app like this). Two
// sources: 'gps' (device location via expo-location, reverse-geocoded to a
// city/state label for display) and 'manual' (the customer typed a city,
// state -- geocoded through the SAME backend endpoint that geocodes
// restaurant addresses isn't available to an unauthenticated lookup here,
// so manual entry stores city/state as plain text and the backend's
// city ILIKE match -- not distance -- does the filtering for it; see
// eatsApi.ts's listMarketplaceRestaurants/searchMarketplaceMenu etc.,
// which send `city` whenever there's no lat/lng).
export type EatsLocationSource = 'gps' | 'manual';

export interface EatsLocation {
  source: EatsLocationSource;
  label: string; // what the location chip shows, e.g. "San Jose, CA"
  latitude: number | null;
  longitude: number | null;
  city: string;
  state: string;
}

export const DEFAULT_RADIUS_MILES = 50;

interface LocationContextValue {
  location: EatsLocation | null;
  radiusMiles: number;
  loading: boolean;
  error: string | null;
  permissionDenied: boolean;
  requestDeviceLocation: () => Promise<void>;
  setManualLocation: (city: string, state: string) => void;
  setRadiusMiles: (miles: number) => void;
  clearLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<EatsLocation | null>(null);
  const [radiusMiles, setRadiusMilesState] = useState<number>(DEFAULT_RADIUS_MILES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const requestDeviceLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setError('Location permission denied. Search by city, state, or restaurant name instead.');
        return;
      }
      setPermissionDenied(false);
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      let city = '';
      let state = '';
      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        const place = places[0];
        city = place?.city || place?.subregion || '';
        state = place?.region || '';
      } catch {
        // Reverse geocoding failing doesn't block using the coordinates
        // themselves for radius filtering -- only the display label and
        // the "same city" comparison fallback are affected.
      }
      setLocation({
        source: 'gps',
        label: city && state ? `${city}, ${state}` : city || 'Current location',
        latitude,
        longitude,
        city,
        state,
      });
    } catch {
      setError('Could not get your location. Search by city, state, or restaurant name instead.');
    } finally {
      setLoading(false);
    }
  }, []);

  const setManualLocation = useCallback((city: string, state: string) => {
    const c = city.trim();
    const s = state.trim();
    setError(null);
    setLocation({
      source: 'manual',
      label: c && s ? `${c}, ${s}` : c || s || 'Selected location',
      latitude: null,
      longitude: null,
      city: c,
      state: s,
    });
  }, []);

  const setRadiusMiles = useCallback((miles: number) => {
    setRadiusMilesState(Math.max(1, Math.round(miles)));
  }, []);

  const clearLocation = useCallback(() => {
    setLocation(null);
    setError(null);
  }, []);

  const value = useMemo<LocationContextValue>(
    () => ({
      location,
      radiusMiles,
      loading,
      error,
      permissionDenied,
      requestDeviceLocation,
      setManualLocation,
      setRadiusMiles,
      clearLocation,
    }),
    [location, radiusMiles, loading, error, permissionDenied, requestDeviceLocation, setManualLocation, setRadiusMiles, clearLocation]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useEatsLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useEatsLocation must be used within a LocationProvider');
  return ctx;
}
