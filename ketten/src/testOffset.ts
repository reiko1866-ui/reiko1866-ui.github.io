import { offsetCoordinate } from '../shared/geo';
import type { Coord } from './types';

export function offsetForDevice(deviceId: string, origin: Coord): Coord {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i += 1) {
    hash = (hash * 33 + deviceId.charCodeAt(i)) >>> 0;
  }
  const meters = 90 + (hash % 120);
  const bearing = hash % 360;
  return offsetCoordinate(origin, meters, bearing);
}
