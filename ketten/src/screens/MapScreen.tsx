import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { haversineMeters, formatDistanceHu, formatRelativeTimeHu } from '../../shared/geo';
import { LiveMap } from '../components/LiveMap';
import { colors } from '../theme';
import type { MapFocus, Member, Session } from '../types';

function statusLabel(status: 'offline' | 'connecting' | 'online', demo: boolean) {
  if (demo) return 'Próba mód';
  if (status === 'online') return 'Élő kapcsolat';
  if (status === 'connecting') return 'Csatlakozás…';
  return 'Nincs kapcsolat';
}

export function MapScreen({
  session,
  me,
  partner,
  relayStatus,
  locationDenied,
  onToggleSharing,
  onChangeRelayUrl,
  onSaveRelayUrl,
  onLeave,
  onCloseSettings,
  settingsOpen,
  onOpenSettings,
}: {
  session: Session;
  me: Member | null;
  partner: Member | null;
  relayStatus: 'offline' | 'connecting' | 'online';
  locationDenied: boolean;
  onToggleSharing: (value: boolean) => void;
  onChangeRelayUrl: (value: string) => void;
  onSaveRelayUrl: () => void;
  onLeave: () => void;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  const [focus, setFocus] = useState<MapFocus>('both');
  const [copied, setCopied] = useState(false);

  const distance = useMemo(() => {
    if (!me?.location || !partner?.location || !partner.sharing) return null;
    return haversineMeters(me.location, partner.location);
  }, [me, partner]);

  const waiting = !session.demo && !partner;

  async function copyCode() {
    if (!session.pairCode) return;
    await Clipboard.setStringAsync(session.pairCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function shareCode() {
    if (!session.pairCode) return;
    try {
      await Share.share({
        message: `Csatlakozz hozzám a Ketten appban. A párkód: ${session.pairCode}`,
      });
    } catch {
      await copyCode();
    }
  }

  return (
    <View style={styles.screen}>
      <LiveMap me={me} partner={partner} focus={focus} />

      <View style={styles.topBar}>
        <View
          style={[
            styles.pill,
            relayStatus === 'online' || session.demo
              ? styles.pillOk
              : styles.pillWarn,
          ]}
        >
          <View
            style={[
              styles.dot,
              {
                backgroundColor:
                  relayStatus === 'online' || session.demo ? colors.ok : colors.gold,
              },
            ]}
          />
          <Text style={styles.pillText}>
            {statusLabel(relayStatus, session.demo)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSettings}
          style={styles.gear}
        >
          <Text style={styles.gearText}>Beállítások</Text>
        </Pressable>
      </View>

      {waiting ? (
        <View style={styles.waitCard}>
          <Text style={styles.waitKicker}>VÁROD A PÁRODAT</Text>
          <Text style={styles.code}>{session.pairCode}</Text>
          <Text style={styles.waitSub}>
            Küldd el neki ezt a kódot. Amint belép, megjelenik a térképen.
          </Text>
          <View style={styles.row}>
            <Pressable onPress={copyCode} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>{copied ? 'Másolva' : 'Másolás'}</Text>
            </Pressable>
            <Pressable onPress={shareCode} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Küldés</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {locationDenied ? (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            A helyzethez engedély kell. Kapcsold be a helymeghatározást a
            telefon beállításaiban.
          </Text>
        </View>
      ) : null}

      <View style={styles.sheet}>
        <View style={styles.personRow}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: partner?.color || colors.rose },
            ]}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.personName}>
              {partner?.name || 'A párod még nincs itt'}
            </Text>
            <Text style={styles.personMeta}>
              {partner?.location
                ? `Utoljára ${formatRelativeTimeHu(partner.location.updatedAt)}`
                : session.demo
                  ? 'Próba partner'
                  : 'Még nincs helyzet'}
              {partner?.online ? ' · online' : partner ? ' · nem élő' : ''}
            </Text>
          </View>
          <View style={styles.distanceBox}>
            <Text style={styles.distance}>
              {distance == null ? '—' : formatDistanceHu(distance)}
            </Text>
            <Text style={styles.distanceHint}>köztetek</Text>
          </View>
        </View>

        <View style={styles.shareRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.shareTitle}>
              {session.sharing ? 'A helyzeted látszik' : 'A helyzeted rejtve'}
            </Text>
            <Text style={styles.shareSub}>
              {session.sharing
                ? 'A párod élőben követhet a térképen.'
                : 'Most csak te látod a párod, ő téged nem.'}
            </Text>
          </View>
          <Switch
            value={session.sharing}
            onValueChange={onToggleSharing}
            trackColor={{ false: colors.line, true: colors.ok }}
            thumbColor={colors.text}
          />
        </View>

        <View style={styles.row}>
          <Pressable onPress={() => setFocus('me')} style={styles.focusBtn}>
            <Text style={styles.focusText}>Én</Text>
          </Pressable>
          <Pressable
            onPress={() => setFocus('partner')}
            style={styles.focusBtn}
            disabled={!partner?.location}
          >
            <Text style={styles.focusText}>Párod</Text>
          </Pressable>
          <Pressable onPress={() => setFocus('both')} style={styles.focusBtn}>
            <Text style={styles.focusText}>Mindkettő</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={settingsOpen} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Beállítások</Text>
            <Text style={styles.modalLabel}>Párkód</Text>
            <Text style={styles.codeSmall}>{session.pairCode || 'próba'}</Text>
            <Text style={styles.modalLabel}>Relé szerver</Text>
            <TextInput
              value={session.relayUrl}
              onChangeText={onChangeRelayUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable onPress={onSaveRelayUrl} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Mentés</Text>
            </Pressable>
            <Text style={styles.hint}>
              A két telefonnak ugyanahhoz a reléhez kell csatlakoznia. Otthon:
              a gép Wi-Fi címe, 8787-es port. Távolról: nyilvános wss:// cím.
            </Text>
            <Pressable onPress={onLeave} style={styles.leave}>
              <Text style={styles.leaveText}>Kilépés a párból</Text>
            </Pressable>
            <Pressable onPress={onCloseSettings} style={styles.smallBtn}>
              <Text style={styles.smallBtnText}>Bezárás</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, height: '100%', backgroundColor: colors.bg },
  topBar: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(16,20,26,0.86)',
  },
  pillOk: { borderWidth: 1, borderColor: 'rgba(62,207,142,0.4)' },
  pillWarn: { borderWidth: 1, borderColor: 'rgba(243,191,53,0.4)' },
  pillText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  gear: {
    backgroundColor: 'rgba(16,20,26,0.86)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  gearText: { color: colors.text, fontWeight: '700' },
  waitCard: {
    position: 'absolute',
    top: 108,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(26,34,44,0.94)',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  waitKicker: {
    color: colors.ok,
    fontWeight: '800',
    letterSpacing: 1,
    fontSize: 11,
  },
  code: {
    color: colors.gold,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 4,
    marginVertical: 6,
  },
  waitSub: { color: colors.muted, lineHeight: 20 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  smallBtn: {
    backgroundColor: colors.cardAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  smallBtnText: { color: colors.text, fontWeight: '800' },
  warn: {
    position: 'absolute',
    top: 108,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(128,0,64,0.92)',
    borderRadius: 14,
    padding: 12,
  },
  warnText: { color: colors.text, fontWeight: '700' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(16,20,26,0.94)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  personName: { color: colors.text, fontWeight: '800', fontSize: 17 },
  personMeta: { color: colors.muted, marginTop: 2 },
  distanceBox: { alignItems: 'flex-end' },
  distance: { color: colors.gold, fontWeight: '800', fontSize: 22 },
  distanceHint: { color: colors.muted, fontSize: 12 },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  shareTitle: { color: colors.text, fontWeight: '800' },
  shareSub: { color: colors.muted, marginTop: 4, fontSize: 13 },
  focusBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },
  focusText: { color: colors.text, fontWeight: '800' },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 8,
  },
  modalTitle: { color: colors.text, fontSize: 24, fontWeight: '800' },
  modalLabel: { color: colors.muted, fontWeight: '700', marginTop: 8 },
  codeSmall: {
    color: colors.gold,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 3,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hint: { color: colors.muted, lineHeight: 20, marginTop: 4 },
  leave: {
    marginTop: 8,
    backgroundColor: 'rgba(232,93,117,0.16)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  leaveText: { color: colors.rose, fontWeight: '800' },
});
