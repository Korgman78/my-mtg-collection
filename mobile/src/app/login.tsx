import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import { AppText, Button, Screen, TextField } from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === 'signup';
  const passwordTooShort = password.length > 0 && password.length < 6;

  async function submit() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (!isSignup) {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) setError(err.message);
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) setError(err.message);
        else if (!data.session) setInfo('Compte créé — vérifie tes emails pour confirmer.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.mark}>
            <Icon name="layers" size={22} color={Colors.text} strokeWidth={1.8} />
          </View>
          <AppText variant="title">Grimoire</AppText>
          <AppText variant="body" style={styles.tagline}>
            Ta collection Magic, ses prix, et leurs mouvements.
          </AppText>
        </View>

        <View style={styles.form}>
          <TextField
            label="Email"
            placeholder="toi@exemple.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Mot de passe"
            placeholder={isSignup ? '6 caractères minimum' : '••••••••'}
            secureTextEntry
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChangeText={setPassword}
            error={passwordTooShort ? '6 caractères minimum.' : undefined}
          />

          {error ? (
            <View style={[styles.notice, styles.noticeError]}>
              <AppText variant="caption" style={{ color: Colors.danger }}>
                {error}
              </AppText>
            </View>
          ) : null}
          {info ? (
            <View style={[styles.notice, styles.noticeInfo]}>
              <AppText variant="caption" style={{ color: Colors.up }}>
                {info}
              </AppText>
            </View>
          ) : null}

          <Button
            label={isSignup ? 'Créer le compte' : 'Se connecter'}
            size="lg"
            onPress={submit}
            loading={loading}
            disabled={!email || password.length < 6}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(isSignup ? 'signin' : 'signup');
              setError(null);
              setInfo(null);
            }}
            style={styles.switchMode}
            hitSlop={8}>
            <AppText variant="caption">
              {isSignup ? 'Déjà un compte ?' : 'Pas encore de compte ?'}{' '}
              <AppText variant="caption" style={styles.switchLink}>
                {isSignup ? 'Se connecter' : 'Créer un compte'}
              </AppText>
            </AppText>
          </Pressable>
        </View>

        <AppText variant="caption" style={styles.attribution}>
          Données cartes et prix : Scryfall
        </AppText>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Space.xl, justifyContent: 'center', gap: Space.xxl },
  hero: { alignItems: 'center', gap: Space.sm },
  mark: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.xs,
  },
  tagline: { color: Colors.textSecondary, textAlign: 'center', maxWidth: 280 },
  form: { gap: Space.lg },
  notice: { borderRadius: Radius.md, padding: Space.md },
  noticeError: { backgroundColor: Colors.dangerSoft },
  noticeInfo: { backgroundColor: Colors.upSoft },
  switchMode: { alignSelf: 'center', paddingVertical: Space.xs },
  switchLink: { color: Colors.text, fontWeight: '600' },
  attribution: { textAlign: 'center', color: Colors.textTertiary },
});
