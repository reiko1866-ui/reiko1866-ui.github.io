import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../theme';

export function PairScreen({
  joinCode,
  onChangeJoinCode,
  onCreate,
  onJoin,
  onDemo,
  busy,
  error,
}: {
  joinCode: string;
  onChangeJoinCode: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onDemo: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>Párosítás</Text>
      <Text style={styles.sub}>
        Az egyikőtök létrehoz egy párt, a másik a 6 karakteres kóddal
        csatlakozik. Ennyi.
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={onCreate}
        disabled={busy}
        style={styles.primary}
      >
        <Text style={styles.primaryText}>Pár létrehozása</Text>
      </Pressable>

      <Text style={styles.or}>vagy csatlakozás kóddal</Text>
      <TextInput
        value={joinCode}
        onChangeText={onChangeJoinCode}
        placeholder="ABC123"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        style={styles.input}
      />
      <Pressable
        accessibilityRole="button"
        onPress={onJoin}
        disabled={busy || joinCode.trim().length < 6}
        style={[
          styles.secondary,
          (busy || joinCode.trim().length < 6) && styles.disabled,
        ]}
      >
        <Text style={styles.secondaryText}>Csatlakozás</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.demoBox}>
        <Text style={styles.demoTitle}>Egyedül próbálnád?</Text>
        <Text style={styles.demoSub}>
          A próba térkép egy sétáló partnert mutat Budapest körül, szerver
          nélkül.
        </Text>
        <Pressable accessibilityRole="button" onPress={onDemo} style={styles.demoBtn}>
          <Text style={styles.demoBtnText}>Próba térkép</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '800',
  },
  sub: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 22,
  },
  primary: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 16 },
  or: {
    color: colors.muted,
    textAlign: 'center',
    marginVertical: 16,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    letterSpacing: 3,
    textAlign: 'center',
    fontWeight: '800',
  },
  secondary: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  secondaryText: { color: colors.text, fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.4 },
  error: { color: colors.danger, marginTop: 12, fontWeight: '700' },
  demoBox: {
    marginTop: 28,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  demoTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  demoSub: { color: colors.muted, marginTop: 6, lineHeight: 20 },
  demoBtn: { marginTop: 12, alignSelf: 'flex-start' },
  demoBtnText: { color: colors.gold, fontWeight: '800' },
});
