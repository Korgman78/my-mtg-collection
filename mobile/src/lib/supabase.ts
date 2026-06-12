import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase non configuré : copie mobile/.env.example vers mobile/.env et renseigne EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

// `window` n'existe pas pendant un éventuel rendu côté Node (export web) :
// dans ce cas on n'attache pas de storage et on ne persiste pas la session.
const canPersist = typeof window !== 'undefined';

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: canPersist ? AsyncStorage : undefined,
    autoRefreshToken: canPersist,
    persistSession: canPersist,
    detectSessionInUrl: false,
  },
});

// Rafraîchit le token quand l'app revient au premier plan.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
