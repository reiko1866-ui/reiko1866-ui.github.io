import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { initials } from '../../shared/geo';

export function AvatarPin({
  name,
  color,
  pulse = false,
  size = 44,
}: {
  name: string;
  color: string;
  pulse?: boolean;
  size?: number;
}) {
  return (
    <View style={[styles.wrap, { width: size + 10, height: size + 10 }]}>
      {pulse ? (
        <View
          style={[
            styles.pulse,
            {
              width: size + 10,
              height: size + 10,
              borderRadius: (size + 10) / 2,
              backgroundColor: color,
            },
          ]}
        />
      ) : null}
      <View
        style={[
          styles.pin,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
        ]}
      >
        <Text style={[styles.letter, { fontSize: size * 0.34 }]}>
          {initials(name)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    opacity: 0.28,
  },
  pin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.text,
  },
  letter: {
    color: colors.text,
    fontWeight: '800',
  },
});
