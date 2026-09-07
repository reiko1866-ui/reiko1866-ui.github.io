import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK } from './theme';
import type { LocationFix } from './types';

export async function requestLocationPermission(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  return fg.status === 'granted';
}

export async function startBackgroundUpdates(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return false;
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (!started) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 25,
      deferredUpdatesInterval: 15000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Ketten',
        notificationBody: 'A helyzeted meg van osztva a pároddal.',
      },
    });
  }
  return true;
}

export async function stopBackgroundUpdates(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // Task may be undefined in Expo Go.
  }
}

export function useMyLocation(enabled: boolean) {
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const ok = await requestLocationPermission();
      if (!ok) {
        setDenied(true);
        return;
      }
      setDenied(false);
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 3000,
          distanceInterval: 8,
        },
        (location) => {
          if (cancelled) return;
          setFix({
            lat: location.coords.latitude,
            lng: location.coords.longitude,
            heading: location.coords.heading,
            speed: location.coords.speed,
            accuracy: location.coords.accuracy,
            updatedAt: location.timestamp || Date.now(),
          });
        },
      );
    })();

    const appSub = AppState.addEventListener('change', () => undefined);

    return () => {
      cancelled = true;
      sub?.remove();
      appSub.remove();
    };
  }, [enabled]);

  return { fix, denied };
}

export function isBackgroundTaskDefined(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    return TaskManager.isTaskDefined(LOCATION_TASK);
  } catch {
    return false;
  }
}
