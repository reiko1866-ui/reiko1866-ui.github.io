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

export function WelcomeScreen({
  name,
  onChangeName,
  onContinue,
}: {
  name: string;
  onChangeName: (value: string) => void;
  onContinue: () => void;
}) {
  const ready = name.trim().length >= 2;
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.hero}>
        <Text style={styles.kicker}>KÖLCSÖNÖS HELYZET</Text>
        <Text style={styles.title}>Ketten</Text>
        <Text style={styles.sub}>
          Te és a párod élőben látjátok egymást a térképen. A helyzet csak
          köztetek megy, párkóddal.
        </Text>
      </View>
      <Text style={styles.label}>Hogy hívnak?</Text>
      <TextInput
        value={name}
        onChangeText={onChangeName}
        placeholder="Például Anna"
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        autoCorrect={false}
        style={styles.input}
        returnKeyType="done"
        onSubmitEditing={() => ready && onContinue()}
      />
      <Pressable
        accessibilityRole="button"
        onPress={onContinue}
        disabled={!ready}
        style={[styles.button, !ready && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>Tovább</Text>
      </Pressable>
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
  hero: { marginBottom: 28 },
  kicker: {
    color: colors.ok,
    fontWeight: '800',
    letterSpacing: 1.4,
    fontSize: 12,
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  sub: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 10,
    maxWidth: 360,
  },
  label: {
    color: colors.muted,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
  },
  button: {
    marginTop: 16,
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 16,
  },
});
