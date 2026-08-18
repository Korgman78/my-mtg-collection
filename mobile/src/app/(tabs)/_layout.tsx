// Barre d'onglets.
//
// Pourquoi des onglets : les alertes vivaient derrière une icône muette dans
// un coin de l'en-tête, et personne ne les trouvait. Une destination visible
// en permanence règle le problème une fois pour toutes. L'emplacement du
// milieu, réservé de longue date, est occupé par le scanner depuis la phase 3.
//
// SDK 54 : `expo-router/js-tabs` n'existe pas encore (il arrive en 56),
// l'entrée correcte est `expo-router`. À reprendre le jour où le projet
// remontera de SDK — c'est le seul fichier concerné.

import { Tabs } from 'expo-router';
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
        tabBarActiveTintColor: Colors.accent,
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
        name="scan"
        options={{
          title: 'Scanner',
          tabBarIcon: ({ color }) => <Icon name="card" size={21} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trends"
        options={{
          title: 'Tendances',
          tabBarIcon: ({ color }) => <Icon name="chart" size={21} color={color} />,
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
    borderTopColor: Colors.rule,
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
