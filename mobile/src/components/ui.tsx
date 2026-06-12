// Primitives visuelles partagées : écran, textes, boutons, surfaces, badges.

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={styles.screen}>
      <SafeAreaView style={[styles.safe, style]}>{children}</SafeAreaView>
    </View>
  );
}

type TextVariant = 'title' | 'heading' | 'body' | 'secondary' | 'small' | 'mono' | 'price';

export function AppText({
  variant = 'body',
  style,
  children,
  numberOfLines,
}: {
  variant?: TextVariant;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[textStyles[variant], style]}>
      {children}
    </Text>
  );
}

export function Surface({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.surface, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'danger' && styles.buttonDanger,
        (pressed || inactive) && { opacity: 0.6 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.bg : Colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === 'primary' && { color: Colors.bg },
            variant === 'danger' && { color: Colors.danger },
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={Colors.textSecondary}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

/** Badge de variation de prix : vert si hausse, rouge si baisse. */
export function ChangeBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined || pct === 0) return null;
  const up = pct > 0;
  return (
    <View style={[styles.badge, { backgroundColor: up ? Colors.upSoft : Colors.downSoft }]}>
      <Text style={[styles.badgeText, { color: up ? Colors.up : Colors.down }]}>
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1).replace('.', ',')} %
      </Text>
    </View>
  );
}

export function FinishBadge({ finish }: { finish: string }) {
  if (finish === 'nonfoil') return null;
  return (
    <View style={[styles.badge, { backgroundColor: 'rgba(125, 211, 252, 0.14)' }]}>
      <Text style={[styles.badgeText, { color: Colors.foil }]}>
        {finish === 'foil' ? '✦ Foil' : '✦ Etched'}
      </Text>
    </View>
  );
}

export function EmptyState({ glyph, title, hint }: { glyph: string; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyGlyph}>{glyph}</Text>
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {hint ? (
        <AppText variant="secondary" style={{ textAlign: 'center' }}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  safe: { flex: 1 },
  surface: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.three,
  },
  button: {
    height: 52,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  buttonPrimary: { backgroundColor: Colors.accent },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
  },
  buttonLabel: { fontSize: 16, fontWeight: '600', color: Colors.text },
  input: {
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.three,
    color: Colors.text,
    fontSize: 16,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.five,
  },
  emptyGlyph: { fontSize: 44, marginBottom: Spacing.two },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

const textStyles = StyleSheet.create({
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Fonts?.serif,
    letterSpacing: 0.2,
  },
  heading: { fontSize: 19, fontWeight: '700', color: Colors.text },
  body: { fontSize: 16, color: Colors.text },
  secondary: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  small: { fontSize: 12, color: Colors.textSecondary },
  mono: { fontSize: 13, color: Colors.textSecondary, fontFamily: Fonts?.mono },
  price: { fontSize: 17, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
});
