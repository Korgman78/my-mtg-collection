import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { AppText, Button, Screen, TextField } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
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
          <AppText style={styles.glyph}>✦</AppText>
          <AppText variant="title">Grimoire</AppText>
          <AppText variant="secondary" style={{ textAlign: 'center' }}>
            Ta collection Magic, ses prix,{'\n'}et leurs mouvements.
          </AppText>
        </View>

        <View style={styles.form}>
          <TextField
            placeholder="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            placeholder="Mot de passe"
            secureTextEntry
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChangeText={setPassword}
          />
          {error ? <AppText style={{ color: Colors.danger }}>{error}</AppText> : null}
          {info ? <AppText style={{ color: Colors.up }}>{info}</AppText> : null}
          <Button
            label={mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
            onPress={submit}
            loading={loading}
            disabled={!email || password.length < 6}
          />
          <Button
            label={mode === 'signin' ? 'Pas encore de compte ? Inscription' : 'Déjà un compte ? Connexion'}
            variant="ghost"
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError(null);
              setInfo(null);
            }}
          />
        </View>

        <AppText variant="small" style={styles.attribution}>
          Données cartes et prix : Scryfall
        </AppText>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.four, justifyContent: 'center' },
  hero: { alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.five },
  glyph: { fontSize: 40, color: Colors.accent },
  form: { gap: Spacing.three },
  attribution: { textAlign: 'center', marginTop: Spacing.five },
});
