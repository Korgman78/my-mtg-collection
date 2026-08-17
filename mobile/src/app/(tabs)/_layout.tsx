// Barre d'onglets.
//
// Pourquoi des onglets : les alertes vivaient derrière une icône muette dans
// un coin de l'en-tête, et personne ne les trouvait. Une destination visible
// en permanence règle le problème une fois pour toutes. L'emplacement du
// milieu est réservé au scanner (phase 3).
//
// SDK 56 : `import { Tabs } from 'expo-router'` est déprécié, l'entrée
// non dépréciée est `expo-router/js-tabs`.

import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';

import { Icon } from '@/components/icons';
import { Colors, Fonts, Space } from '@/constants/theme';
import { useUnseenAlertCount } from '@/lib/alerts';

export default function TabsLayout() {
  const { data: unseen = 0 } = useUnseenAlertCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.bg },
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
        tabBarActiveTintColor: Colors.text,
        tabBarInactiveTintColor: Colors.textTertiary,
        tabBarBadgeStyle: styles.badge,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Collection',
          tabBarIcon: ({ color }) => <Icon name="layers" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alertes',
          tabBarIcon: ({ color }) => <Icon name="bell" size={21} color={color} />,
          tabBarBadge: unseen > 0 ? (unseen > 9 ? '9+' : unseen) : undefined,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    height: 62,
    paddingTop: Space.sm,
    paddingBottom: Space.sm,
    elevation: 0,
  },
  item: { gap: 2 },
  label: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Fonts?.sans,
    letterSpacing: -0.1,
  },
  badge: {
    backgroundColor: Colors.accent,
    color: Colors.onAccent,
    fontSize: 10,
    fontWeight: '700',
    minWidth: 16,
    height: 16,
    lineHeight: 13,
  },
});
