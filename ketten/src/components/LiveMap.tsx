import { createElement, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import L from 'leaflet';
import { initials } from '../../shared/geo';
import { BUDAPEST } from '../theme';
import type { MapFocus, Member } from '../types';

type Props = {
  me: Member | null;
  partner: Member | null;
  focus: MapFocus;
};

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ketten-leaflet-css')) return;
  const link = document.createElement('link');
  link.id = 'ketten-leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.id = 'ketten-leaflet-fix';
  style.textContent = `
    .ketten-pin { background: transparent; border: 0; }
    .ketten-pin-inner {
      width: 42px; height: 42px; border-radius: 21px;
      display: flex; align-items: center; justify-content: center;
      color: #eef3f7; font: 800 13px/1 system-ui, sans-serif;
      border: 2px solid #eef3f7; box-shadow: 0 6px 18px rgba(0,0,0,.4);
    }
  `;
  document.head.appendChild(style);
}

function pinIcon(member: Member) {
  return L.divIcon({
    className: 'ketten-pin',
    html: `<div class="ketten-pin-inner" style="background:${member.color}">${initials(member.name)}</div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

export function LiveMap({ me, partner, focus }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markers = useRef<{ me?: L.Marker; partner?: L.Marker }>({});
  const lineRef = useRef<L.Polyline | null>(null);

  const mePos = me?.location;
  const partnerPos = partner?.sharing ? partner.location : null;

  const Div = useMemo(
    () => 'div' as unknown as ComponentType<Record<string, unknown>>,
    [],
  );

  useEffect(() => {
    ensureCss();
    const el = hostRef.current;
    if (!el || mapRef.current) return;
    const map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
    }).setView([BUDAPEST.lat, BUDAPEST.lng], 13);
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19 },
    ).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncMarker = (
      key: 'me' | 'partner',
      member: Member | null,
      loc: Member['location'],
    ) => {
      if (!member || !loc) {
        markers.current[key]?.remove();
        delete markers.current[key];
        return;
      }
      const latlng: L.LatLngExpression = [loc.lat, loc.lng];
      if (!markers.current[key]) {
        markers.current[key] = L.marker(latlng, { icon: pinIcon(member) }).addTo(map);
      } else {
        markers.current[key]!.setLatLng(latlng);
        markers.current[key]!.setIcon(pinIcon(member));
      }
    };

    syncMarker('me', me, mePos || null);
    syncMarker('partner', partner, partnerPos || null);

    if (mePos && partnerPos) {
      const latlngs: L.LatLngExpression[] = [
        [mePos.lat, mePos.lng],
        [partnerPos.lat, partnerPos.lng],
      ];
      if (!lineRef.current) {
        lineRef.current = L.polyline(latlngs, {
          color: '#F3BF35',
          weight: 2,
          dashArray: '6 8',
          opacity: 0.7,
        }).addTo(map);
      } else {
        lineRef.current.setLatLngs(latlngs);
      }
    } else {
      lineRef.current?.remove();
      lineRef.current = null;
    }

    if (focus === 'me' && mePos) {
      map.panTo([mePos.lat, mePos.lng]);
    } else if (focus === 'partner' && partnerPos) {
      map.panTo([partnerPos.lat, partnerPos.lng]);
    } else if (focus === 'both' && mePos && partnerPos) {
      map.fitBounds(
        [
          [mePos.lat, mePos.lng],
          [partnerPos.lat, partnerPos.lng],
        ],
        { padding: [80, 80] },
      );
    } else if (focus === 'both' && mePos) {
      map.panTo([mePos.lat, mePos.lng]);
    }
  }, [me, partner, mePos, partnerPos, focus]);

  return (
    <View style={styles.fill}>
      {createElement(Div, {
        ref: (node: HTMLDivElement | null) => {
          hostRef.current = node;
        },
        style: { width: '100%', height: '100%' },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#10141A' },
});
