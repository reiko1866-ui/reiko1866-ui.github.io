import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { LOCATION_TASK } from './theme';
import { loadSession } from './storage';
import { postLocation } from './api';
import { offsetForDevice } from './testOffset';

if (Platform.OS !== 'web') {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) return;
    const locations = (data as { locations?: Location.LocationObject[] })?.locations;
    const loc = locations?.[0];
    if (!loc) return;
    try {
      const session = await loadSession();
      if (!session.pairCode || !session.sharing || session.demo) return;
      const origin = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };
      const published = session.testOffset
        ? offsetForDevice(session.deviceId, origin)
        : origin;
      await postLocation(session.relayUrl, {
        pairCode: session.pairCode,
        deviceId: session.deviceId,
        lat: published.lat,
        lng: published.lng,
        heading: loc.coords.heading,
        speed: loc.coords.speed,
        accuracy: loc.coords.accuracy,
        sharing: true,
      });
    } catch {
      // Background uploads are best-effort.
    }
  });
}
