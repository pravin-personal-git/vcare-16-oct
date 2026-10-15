'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * The map an admin actually picks a branch's geofences on - Leaflet over
 * OpenStreetMap tiles, because neither needs an API key or billing set up
 * before this screen works.
 *
 * MARKER ICONS COME FROM A CDN, NOT THE BUNDLE.
 *
 * Leaflet's default marker images are referenced by a relative path baked
 * into the package, which webpack/Next cannot resolve without extra config.
 * Pointing at the same package version's own images on unpkg sidesteps that
 * - these are static image files, not a mapping API call, so there is
 * nothing to key or bill.
 */

const ICON_BASE = 'https://unpkg.com/leaflet@1.9.4/dist/images';

const savedIcon = L.icon({
  iconUrl: `${ICON_BASE}/marker-icon.png`,
  iconRetinaUrl: `${ICON_BASE}/marker-icon-2x.png`,
  shadowUrl: `${ICON_BASE}/marker-shadow.png`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const draftIcon = L.icon({
  iconUrl: `${ICON_BASE}/marker-icon.png`,
  iconRetinaUrl: `${ICON_BASE}/marker-icon-2x.png`,
  shadowUrl: `${ICON_BASE}/marker-shadow.png`,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'atlas-draft-marker',
});

const INDIA_CENTER: [number, number] = [22.9734, 78.6569];

export interface MapZone {
  id: string;
  label: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Recenters the map whenever the draft position changes from outside a drag - e.g. a search result or a manual coordinate edit. */
function RecenterOn({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (lat === null || lng === null) return;
    const key = `${lat},${lng}`;
    if (key === last.current) return;
    last.current = key;
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [lat, lng, map]);
  return null;
}

interface SearchResult { label: string; lat: number; lng: number }

/** Free-text address search against Nominatim - no API key, courtesy-debounced. */
function AddressSearch({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 3) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
        );
        const data = await res.json();
        setResults((Array.isArray(data) ? data : []).map((r: { display_name: string; lat: string; lon: string }) => ({
          label: r.display_name, lat: Number(r.lat), lng: Number(r.lon),
        })));
      } catch {
        setResults([]);
      } finally {
        setBusy(false);
      }
    }, 1000); // courtesy delay - Nominatim's usage policy asks for at most one request a second
  };

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search for an address…"
        className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      {busy && <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">Searching…</span>}
      {results.length > 0 && (
        <ul className="absolute z-[1000] mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => { onPick(r.lat, r.lng); setResults([]); setQuery(r.label); }}
                className="block w-full truncate px-3 py-2 text-start text-xs hover:bg-muted"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AttendanceZoneMap({
  zones, draftLat, draftLng, draftRadiusMeters, onDraftChange, height = '320px',
}: {
  zones: MapZone[];
  draftLat: number | null;
  draftLng: number | null;
  draftRadiusMeters: number;
  onDraftChange: (lat: number, lng: number) => void;
  height?: string;
}) {
  const center: [number, number] = draftLat !== null && draftLng !== null
    ? [draftLat, draftLng]
    : zones.length > 0
      ? [zones[0].lat, zones[0].lng]
      : INDIA_CENTER;
  const zoom = draftLat !== null && draftLng !== null ? 15 : zones.length > 0 ? 14 : 5;

  return (
    <div>
      <style>{'.atlas-draft-marker { filter: hue-rotate(140deg) saturate(1.4); }'}</style>
      <div className="mb-2">
        <AddressSearch onPick={onDraftChange} />
      </div>
      <div style={{ height }} className="overflow-hidden rounded-lg border border-border">
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPick={onDraftChange} />
          <RecenterOn lat={draftLat} lng={draftLng} />

          {zones.map((z) => (
            <div key={z.id}>
              <Marker position={[z.lat, z.lng]} icon={savedIcon} />
              <Circle center={[z.lat, z.lng]} radius={z.radiusMeters} pathOptions={{ color: 'hsl(var(--info))', fillOpacity: 0.08 }} />
            </div>
          ))}

          {draftLat !== null && draftLng !== null && (
            <>
              <Marker
                position={[draftLat, draftLng]}
                icon={draftIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const { lat, lng } = e.target.getLatLng();
                    onDraftChange(lat, lng);
                  },
                }}
              />
              <Circle
                center={[draftLat, draftLng]}
                radius={draftRadiusMeters}
                pathOptions={{ color: 'hsl(var(--success))', fillOpacity: 0.15 }}
              />
            </>
          )}
        </MapContainer>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Search an address, click the map, or drag the green pin to place a new location.
      </p>
    </div>
  );
}
