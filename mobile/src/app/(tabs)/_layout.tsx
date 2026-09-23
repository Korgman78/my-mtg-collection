// Barre d'onglets.
//
// Pourquoi des onglets : les alertes vivaient derrière une icône muette dans
// un coin de l'en-tête, et personne ne les trouvait. Une destination visible
// en permanence règle le problème une fois pour toutes.
//
// Le scanner a occupé l'emplacement du milieu pendant la phase 3. Il n'a
// plus d'onglet : on scanne toujours VERS quelque chose (un dossier, un
// cube), et l'onglet obligeait à choisir la destination après coup. Il
// s'ouvre désormais depuis le dossier ou le cube à remplir. Sa place est
// reprise, à droite, par le cube builder.
//
// SDK 54 : `expo-router/js-tabs` n'existe pas encore (il arrive en 56),
// l'entrée correcte est `expo-router`. À reprendre le jour où le projet
// remontera de SDK — c'est le seul fichier concerné.

import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icons';
import { Colors, Fonts, Space } from '@/constants/theme';
import { useUnseenAlertCount } from '@/lib/alerts';

// Hauteur de la barre elle-même, hors zone système.
const BAR_HEIGHT = 62;

export default function TabsLayout() {
  const { data: unseen = 0 } = useUnseenAlertCount();
  // Fixer la hauteur en dur écrase le calcul de zone sûre de React Navigation :
  // sur un Android à navigation gestuelle ou à trois boutons, la barre passait
  // sous les commandes du système. On réintègre donc l'inset à la main, en
  // hauteur ET en marge basse — la hauteur seule laisserait les libellés collés
  // au bord.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.bg },
        tabBarStyle: [
          styles.bar,
          { height: BAR_HEIGHT + insets.bottom, paddingBottom: Space.sm + insets.bottom },
        ],
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
      <Tabs.Screen
        name="cubes"
        options={{
          title: 'Cubes',
          tabBarIcon: ({ color }) => <Icon name="cube" size={21} color={color} />,
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
    height: BAR_HEIGHT,
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
