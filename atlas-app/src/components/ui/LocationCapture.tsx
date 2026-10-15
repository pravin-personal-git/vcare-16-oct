'use client';

import { useState } from 'react';
import { Icon } from './Icon';
import { resolveLocationInputAction } from '@/app/actions/maps-link';

/**
 * Where a complaint's site actually is - captured one of two mandatory
 * ways, never typed as free text.
 *
 * WHY TWO WAYS, NOT ONE.
 *
 * "Use my location" only works if the person raising the complaint is
 * physically at the site right now. A customer very often isn't - they are
 * describing a problem with equipment at a warehouse, a client's office, a
 * site they visited yesterday. Pasting a Google Maps link for the place is
 * the second path, and it resolves server-side (see app/actions/maps-link.ts)
 * because a short link only reveals coordinates after a redirect a browser
 * cannot follow across origins.
 *
 * A controlled component - `value`/`onChange`, no hidden form inputs - so it
 * works identically inside a native `<form action>` (the portal's dialog)
 * and a JS-object server-action call (the staff dialog), by having each
 * caller read `value` before submitting rather than this component owning
 * form state itself.
 */

export interface CapturedLocation {
  lat: number;
  lng: number;
  source: 'gps' | 'maps_link';
}

export function LocationCapture({
  value, onChange, required = true, requiredText = 'Required to raise a complaint.',
}: {
  value: CapturedLocation | null;
  onChange: (v: CapturedLocation | null) => void;
  required?: boolean;
  /** The line under the box when a location is required. */
  requiredText?: string;
}) {
  const [mode, setMode] = useState<'gps' | 'link'>('gps');
  const [linkInput, setLinkInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useMyLocation = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError('This browser cannot share its location. Paste a Maps link instead.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'gps' });
      },
      () => {
        setBusy(false);
        setError('Location was not shared. Allow location access, or paste a Maps link instead.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const useLink = async () => {
    setError(null);
    if (!linkInput.trim()) { setError('Paste a Google Maps link first.'); return; }
    setBusy(true);
    const result = await resolveLocationInputAction(linkInput);
    setBusy(false);
    if (!result) {
      setError('Could not read a location from that link. Copy the link from the Share button in Google Maps.');
      return;
    }
    onChange({ lat: result.lat, lng: result.lng, source: 'maps_link' });
  };

  if (value) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/5 p-3">
        <div className="flex items-center gap-2">
          <Icon name="check-circle" className="h-4 w-4 shrink-0 text-success" />
          <p className="min-w-0 flex-1 text-xs font-medium">
            Location captured {value.source === 'gps' ? '(this device’s location)' : '(from a Maps link)'}
          </p>
          <button type="button" onClick={() => { onChange(null); setLinkInput(''); }}
            className="shrink-0 text-xs font-medium text-muted-foreground underline hover:text-foreground">
            Change
          </button>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex gap-1.5 rounded-lg bg-muted/60 p-0.5">
        <button type="button" onClick={() => { setMode('gps'); setError(null); }}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            mode === 'gps' ? 'bg-card text-brand shadow-card' : 'text-muted-foreground'
          }`}>
          Use my location
        </button>
        <button type="button" onClick={() => { setMode('link'); setError(null); }}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
            mode === 'link' ? 'bg-card text-brand shadow-card' : 'text-muted-foreground'
          }`}>
          Paste a Maps link
        </button>
      </div>

      <div className="mt-3">
        {mode === 'gps' ? (
          <button type="button" disabled={busy} onClick={useMyLocation}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg transition hover:opacity-90 disabled:opacity-60">
            <Icon name={busy ? 'refresh' : 'map-pin'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Finding your location…' : 'Share this device’s location'}
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus:border-brand"
            />
            <button type="button" disabled={busy} onClick={useLink}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg transition hover:opacity-90 disabled:opacity-60">
              <Icon name={busy ? 'refresh' : 'external-link'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
              Use
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <Icon name="alert-circle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {required && !error && (
        <p className="mt-2 text-xs text-muted-foreground">{requiredText}</p>
      )}
    </div>
  );
}
