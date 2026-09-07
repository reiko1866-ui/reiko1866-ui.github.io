export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number;

export function bearingDegrees(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number;

export function offsetCoordinate(
  origin: { lat: number; lng: number },
  meters: number,
  bearingDeg: number,
): { lat: number; lng: number };

export function formatDistanceHu(meters: number): string;
export function formatRelativeTimeHu(timestamp: number, now?: number): string;
export function initials(name: string): string;
