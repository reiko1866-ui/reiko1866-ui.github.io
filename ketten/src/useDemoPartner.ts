import { useEffect, useState } from 'react';
import { offsetCoordinate } from '../shared/geo';
import { BUDAPEST } from './theme';
import type { Coord, Member } from './types';

export function useDemoPartner(origin: Coord | null, enabled: boolean): Member | null {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;
  const center = origin || BUDAPEST;
  const bearing = ((now / 1000) * 18) % 360;
  const pos = offsetCoordinate(center, 160, bearing);
  return {
    deviceId: 'demo-partner',
    name: 'Próba',
    color: '#E85D75',
    sharing: true,
    online: true,
    location: {
      lat: pos.lat,
      lng: pos.lng,
      heading: (bearing + 90) % 360,
      speed: 1.4,
      accuracy: 10,
      updatedAt: now,
    },
  };
}
