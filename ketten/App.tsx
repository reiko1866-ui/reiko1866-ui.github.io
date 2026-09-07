import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { colors } from './src/theme';
import type { Member, Session } from './src/types';
import { loadSession, saveSession } from './src/storage';
import { createPair, joinPair, leavePair, postSharing } from './src/api';
import { useRelay } from './src/useRelay';
import { startBackgroundUpdates, stopBackgroundUpdates, useMyLocation } from './src/useMyLocation';
import { useDemoPartner } from './src/useDemoPartner';
import { offsetForDevice } from './src/testOffset';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { PairScreen } from './src/screens/PairScreen';
import { MapScreen } from './src/screens/MapScreen';

type Route = 'boot' | 'welcome' | 'pair' | 'map';

export default function App() {
  const [route, setRoute] = useState<Route>('boot');
  const [session, setSession] = useState<Session | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const onMap = route === 'map' && Boolean(session);
  const { fix, denied } = useMyLocation(onMap);
  const demoPartner = useDemoPartner(
    fix,
    Boolean(session?.demo && onMap),
  );

  const relay = useRelay({
    enabled: Boolean(onMap && session && !session.demo && session.pairCode),
    relayUrl: session?.relayUrl || '',
    pairCode: session?.pairCode || null,
    deviceId: session?.deviceId || '',
    name: session?.name || '',
  });

  const publishedFix = useMemo(() => {
    if (!fix || !session) return null;
    if (!session.testOffset) return fix;
    const shifted = offsetForDevice(session.deviceId, fix);
    return { ...fix, ...shifted };
  }, [fix, session]);

  useEffect(() => {
    (async () => {
      const loaded = await loadSession();
      await saveSession(loaded);
      setSession(loaded);
      if (!loaded.name.trim()) setRoute('welcome');
      else if (loaded.pairCode || loaded.demo) setRoute('map');
      else setRoute('pair');
    })();
  }, []);

  useEffect(() => {
    if (!session || !onMap || session.demo || !session.sharing || !publishedFix) return;
    relay.send({
      type: 'location',
      lat: publishedFix.lat,
      lng: publishedFix.lng,
      heading: publishedFix.heading,
      speed: publishedFix.speed,
      accuracy: publishedFix.accuracy,
      sharing: true,
    });
  }, [publishedFix, onMap, session, relay.send]);

  useEffect(() => {
    if (!session || !onMap) return;
    if (session.sharing && !session.demo) {
      void startBackgroundUpdates();
      void activateKeepAwakeAsync('ketten');
    } else {
      void stopBackgroundUpdates();
      void deactivateKeepAwake('ketten');
    }
  }, [session, onMap]);

  const updateSession = useCallback(async (next: Session) => {
    setSession(next);
    await saveSession(next);
  }, []);

  const me: Member | null = useMemo(() => {
    if (!session) return null;
    return {
      deviceId: session.deviceId,
      name: session.name || 'Én',
      color: relay.you?.color || '#5B9CFF',
      sharing: session.sharing,
      online: true,
      location: publishedFix,
    };
  }, [session, publishedFix, relay.you]);

  const partner = session?.demo ? demoPartner : relay.partner;

  if (!session || route === 'boot') {
    return (
      <View style={styles.boot}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  if (route === 'welcome') {
    return (
      <View style={styles.flex}>
        <StatusBar style="light" />
        <WelcomeScreen
          name={session.name}
          onChangeName={(name) => setSession({ ...session, name })}
          onContinue={async () => {
            await updateSession({ ...session, name: session.name.trim() });
            setRoute('pair');
          }}
        />
      </View>
    );
  }

  if (route === 'pair') {
    return (
      <View style={styles.flex}>
        <StatusBar style="light" />
        <PairScreen
          joinCode={joinCode}
          onChangeJoinCode={setJoinCode}
          busy={busy}
          error={pairError}
          onCreate={async () => {
            setBusy(true);
            setPairError(null);
            try {
              const result = await createPair(
                session.relayUrl,
                session.deviceId,
                session.name,
              );
              await updateSession({
                ...session,
                pairCode: result.pairCode,
                demo: false,
              });
              setRoute('map');
            } catch (err) {
              setPairError(err instanceof Error ? err.message : 'Nem sikerült.');
            } finally {
              setBusy(false);
            }
          }}
          onJoin={async () => {
            setBusy(true);
            setPairError(null);
            try {
              const result = await joinPair(
                session.relayUrl,
                session.deviceId,
                session.name,
                joinCode,
              );
              await updateSession({
                ...session,
                pairCode: result.pairCode,
                demo: false,
              });
              setRoute('map');
            } catch (err) {
              setPairError(err instanceof Error ? err.message : 'Nem sikerült.');
            } finally {
              setBusy(false);
            }
          }}
          onDemo={async () => {
            await updateSession({ ...session, demo: true, pairCode: 'PROBA' });
            setRoute('map');
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <StatusBar style="light" />
      <MapScreen
        session={session}
        me={me}
        partner={partner}
        relayStatus={relay.status}
        locationDenied={denied}
        settingsOpen={settingsOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        onChangeRelayUrl={(relayUrl) => setSession({ ...session, relayUrl })}
        onSaveRelayUrl={() => updateSession(session)}
        onToggleSharing={async (sharing) => {
          try {
            await Haptics.selectionAsync();
          } catch {
            // Haptics are optional (web / simulator).
          }
          const next = { ...session, sharing };
          await updateSession(next);
          if (!session.demo && session.pairCode) {
            try {
              await postSharing(
                session.relayUrl,
                session.pairCode,
                session.deviceId,
                sharing,
              );
            } catch {
              // WebSocket sharing message is the fallback.
            }
            relay.send({ type: 'sharing', sharing });
          }
        }}
        onLeave={async () => {
          if (session.pairCode && !session.demo) {
            try {
              await leavePair(session.relayUrl, session.deviceId, session.pairCode);
            } catch {
              // Leave even if the server is unreachable.
            }
          }
          await stopBackgroundUpdates();
          await updateSession({ ...session, pairCode: null, demo: false });
          setSettingsOpen(false);
          setRoute('pair');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, height: '100%', backgroundColor: colors.bg },
  boot: {
    flex: 1,
    height: '100%',
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
