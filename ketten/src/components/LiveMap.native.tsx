import { useEffect, useRef } from 'react';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { StyleSheet } from 'react-native';
import { AvatarPin } from './AvatarPin';
import { BUDAPEST } from '../theme';
import type { MapFocus, Member } from '../types';

const NIGHT_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

type Props = {
  me: Member | null;
  partner: Member | null;
  focus: MapFocus;
};

export function LiveMap({ me, partner, focus }: Props) {
  const mapRef = useRef<MapView>(null);
  const mePos = me?.location;
  const partnerPos = partner?.sharing ? partner.location : null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (focus === 'me' && mePos) {
      map.animateToRegion({
        latitude: mePos.lat,
        longitude: mePos.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    } else if (focus === 'partner' && partnerPos) {
      map.animateToRegion({
        latitude: partnerPos.lat,
        longitude: partnerPos.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    } else if (focus === 'both' && mePos && partnerPos) {
      map.fitToCoordinates(
        [
          { latitude: mePos.lat, longitude: mePos.lng },
          { latitude: partnerPos.lat, longitude: partnerPos.lng },
        ],
        {
          animated: true,
          edgePadding: { top: 100, right: 70, bottom: 280, left: 70 },
        },
      );
    } else if (focus === 'both' && mePos) {
      map.animateToRegion({
        latitude: mePos.lat,
        longitude: mePos.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
    }
  }, [focus, mePos, partnerPos]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      customMapStyle={NIGHT_STYLE}
      initialRegion={{
        latitude: mePos?.lat ?? BUDAPEST.lat,
        longitude: mePos?.lng ?? BUDAPEST.lng,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      }}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      rotateEnabled
      pitchEnabled={false}
    >
      {mePos && me ? (
        <Marker
          coordinate={{ latitude: mePos.lat, longitude: mePos.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <AvatarPin name={me.name} color={me.color} pulse={me.sharing} />
        </Marker>
      ) : null}
      {partnerPos && partner ? (
        <Marker
          coordinate={{ latitude: partnerPos.lat, longitude: partnerPos.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <AvatarPin name={partner.name} color={partner.color} pulse={partner.online} />
        </Marker>
      ) : null}
      {mePos && partnerPos ? (
        <Polyline
          coordinates={[
            { latitude: mePos.lat, longitude: mePos.lng },
            { latitude: partnerPos.lat, longitude: partnerPos.lng },
          ]}
          strokeColor="#F3BF35"
          strokeWidth={3}
          lineDashPattern={[6, 8]}
        />
      ) : null}
    </MapView>
  );
}
