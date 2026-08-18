// Scanner v1 : photo → reconnaissance perceptuelle → confirmation → ajout.
//
// Deux partis pris d'interface, tous deux dictés par les mesures :
//
//   - le repère à l'écran a exactement le format d'une carte et sert de
//     découpe à la photo. Le cadrage est, de très loin, le premier facteur
//     de réussite : à 10 % de fond en trop, la reconnaissance passait de
//     60/60 à 31/60 avant qu'on interroge avec plusieurs fenêtres.
//   - l'app ne conclut jamais seule. Elle propose les candidats classés avec
//     leur illustration, et c'est l'œil du joueur qui trance. Un ajout faux
//     et silencieux dans une collection coûte bien plus cher qu'un choix.

import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  Diamond,
  EmptyState,
  Loading,
  Pill,
  Screen,
  Sheet,
  Surface,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { useAddScannedCard, useFoldersLite, useHashedSets } from '@/lib/collection';
import {
  CARD_ASPECT,
  confidenceOf,
  diagnoseScan,
  hashPhoto,
  matchPhoto,
  type ScanMatch,
} from '@/lib/scan';

type Stage =
  | { step: 'idle' }
  | { step: 'working'; label: string }
  | { step: 'results'; matches: ScanMatch[]; previewUri: string; nearest: ScanMatch[] }
  | { step: 'error'; message: string };

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [stage, setStage] = useState<Stage>({ step: 'idle' });
  const [added, setAdded] = useState<string | null>(null);

  // Taille réelle de l'aperçu à l'écran. Sans elle, impossible de savoir
  // quelle portion de la photo le joueur voyait : l'aperçu est en « cover ».
  const [preview, setPreview] = useState({ width: 0, height: 0 });

  const folders = useFoldersLite();
  const hashedSets = useHashedSets();
  const addScanned = useAddScannedCard();

  // Deux chemins d'arrivée. Depuis un dossier, la destination est connue et
  // on n'a rien à demander. Depuis l'onglet, on ne devine PAS : ranger des
  // cartes dans un dossier au hasard parce qu'il était premier dans la liste
  // est le genre d'erreur qu'on ne remarque qu'une fois le mal fait.
  const { folderId: folderParam } = useLocalSearchParams<{ folderId?: string }>();
  const [chosenFolder, setChosenFolder] = useState<string | null>(null);

  // Le paramètre survit à la navigation par onglets : revenir sur l'onglet
  // Scanner après être passé par un dossier resterait verrouillé dessus.
  // D'où cette porte de sortie explicite.
  const [unlocked, setUnlocked] = useState(false);
  const lockedToFolder = !!folderParam && !unlocked;
  const targetFolder = lockedToFolder ? (folderParam ?? null) : chosenFolder;
  const targetName = folders.data?.find((f) => f.id === targetFolder)?.name ?? null;

  // Un refus de permission ne doit jamais être silencieux : c'est ce qui a
  // fait passer ce bouton pour cassé. On garde le dernier résultat et la
  // dernière erreur pour les afficher.
  const [permissionNote, setPermissionNote] = useState<string | null>(null);

  /** Ouvrir les réglages système n'existe QUE en natif : `react-native-web`
   *  n'expose pas `Linking.openSettings`, et l'appeler plantait la page. */
  const canOpenSettings = Platform.OS !== 'web';

  /** Demande la permission caméra, et retombe sur les réglages système si
   *  elle a déjà été refusée — dans ce cas `requestPermission` ne rouvre
   *  aucune boîte de dialogue et ne ferait donc rien de visible. */
  async function askCamera() {
    setPermissionNote('Demande en cours…');
    try {
      const result = await requestPermission();
      setPermissionNote(
        `Réponse : ${result.status}` +
          (result.granted ? '' : ` · redemandable : ${result.canAskAgain ? 'oui' : 'non'}`)
      );
      if (!result.granted && !result.canAskAgain && canOpenSettings) {
        await Linking.openSettings();
      }
    } catch (err) {
      setPermissionNote(`Erreur : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function capture() {
    if (!camera.current) return;
    setAdded(null);
    setStage({ step: 'working', label: 'Lecture de la carte…' });

    try {
      // Une secousse brève remplace le déclencheur sonore : on scanne des
      // dizaines de cartes d'affilée, un « clac » à chaque fois est pénible.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

      // `skipProcessing` est volontairement absent : sur Android il renvoie
      // l'image brute du capteur SANS appliquer l'orientation. La photo
      // arrivait couchée à 90°, et on hachait une carte à l'horizontale.
      //
      // `shutterSound: false` coupe le déclencheur. Réserve honnête : dans
      // certains pays (Japon, Corée) le système impose ce son et l'ignore.
      const photo = await camera.current.takePictureAsync({
        quality: 0.9,
        shutterSound: false,
      });
      if (!photo) throw new Error("La photo n'a pas pu être prise.");

      const { hashes, previewUri } = await hashPhoto(
        photo.uri,
        photo.width,
        photo.height,
        preview.width,
        preview.height
      );
      setStage({ step: 'working', label: 'Recherche dans la référence…' });

      let matches = await matchPhoto(hashes);

      // Rien sous le seuil : on redemande sans seuil. Savoir si la meilleure
      // correspondance est à 16 ou à 30 change complètement le diagnostic —
      // et sans cette mesure, un échec ne nous apprend rien du tout.
      let nearest: ScanMatch[] = [];
      if (matches.length === 0) {
        nearest = await diagnoseScan(hashes);
        console.log(
          `[scan] aucun match sous le seuil. Plus proches : ` +
            (nearest.length === 0
              ? 'aucun (index vide ?)'
              : nearest
                  .slice(0, 3)
                  .map((m) => `${m.name} [${m.set_code}] ${m.distance}`)
                  .join(' · '))
        );
      } else {
        console.log(
          `[scan] ${matches.length} candidat(s) : ` +
            matches.map((m) => `${m.name} ${m.distance}`).join(' · ')
        );
      }

      setStage({ step: 'results', matches, previewUri, nearest });
    } catch (err) {
      setStage({ step: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function addMatch(match: ScanMatch) {
    const folder = targetFolder;
    if (!folder) return;
    addScanned.mutate(
      { folderId: folder, cardId: match.card_id, finish: 'nonfoil' },
      {
        onSuccess: (result) => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          // On dit le total atteint, pas « ajoutée » : sur un playset, savoir
          // qu'on en est au troisième exemplaire est toute l'information.
          setAdded(result.merged ? `${match.name} ×${result.quantity}` : match.name);
          setStage({ step: 'idle' });
        },
      }
    );
  }

  if (!permission) return <Loading />;

  if (!permission.granted) {
    const refused = !permission.canAskAgain;
    return (
      <Screen>
        <AppBar title="Scanner" />
        <EmptyState
          icon="card"
          title="La caméra est nécessaire"
          hint={
            // Sur le web, la cause est presque toujours la même et n'a rien
            // à voir avec une permission : un navigateur refuse la caméra
            // hors contexte sécurisé, c'est-à-dire hors https:// et
            // localhost. Une IP locale en http:// n'en est pas un.
            Platform.OS === 'web'
              ? "Ouvert dans un navigateur. Les navigateurs n'autorisent la caméra qu'en https:// ou sur localhost — une adresse IP en http:// est refusée quoi qu'on fasse. Ouvre l'app dans Expo Go pour scanner."
              : refused
                ? "La caméra a été refusée. Le bouton ouvre les réglages du téléphone : autorise l'appareil photo pour Expo Go, puis reviens ici."
                : "Le scanner reconnaît une carte à partir de sa photo. L'image ne quitte jamais le téléphone : seule son empreinte, 25 fois 64 bits, est envoyée."
          }
          action={{
            label: refused ? 'Ouvrir les réglages' : 'Autoriser la caméra',
            onPress: askCamera,
          }}
        />

        {/* Diagnostic. Tant que la caméra ne s'ouvre pas, ces lignes valent
            mieux qu'un bouton qui semble ne rien faire. */}
        <View style={styles.diagnostic}>
          <AppText variant="caption">
            {Platform.OS} · état : {permission.status} · redemandable :{' '}
            {permission.canAskAgain ? 'oui' : 'non'}
          </AppText>
          {permissionNote ? <AppText variant="caption">{permissionNote}</AppText> : null}
          {canOpenSettings ? (
            <Button
              label="Ouvrir les réglages du téléphone"
              icon="chevronRight"
              variant="ghost"
              size="sm"
              onPress={() => Linking.openSettings()}
            />
          ) : null}
        </View>
      </Screen>
    );
  }

  const scannable = hashedSets.data ?? [];

  return (
    <Screen>
      <AppBar
        title="Scanner"
        subtitle={
          targetName
            ? `Vers « ${targetName} »`
            : scannable.length === 0
              ? 'Aucun set indexé pour l’instant'
              : `${scannable.length} set${scannable.length > 1 ? 's' : ''} reconnaissable${scannable.length > 1 ? 's' : ''}`
        }
      />

      <View
        style={styles.viewfinder}
        onLayout={(e) =>
          setPreview({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />

        {/* Repère : même géométrie que la découpe faite sur la photo. */}
        <View style={styles.frameLayer}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        </View>

        {stage.step === 'working' ? (
          <View style={styles.working}>
            <Surface style={styles.workingCard}>
              <AppText variant="caption" style={{ color: Colors.text }}>
                {stage.label}
              </AppText>
            </Surface>
          </View>
        ) : null}
      </View>

      <View style={styles.bottom}>
        {added ? (
          <View style={styles.addedLine}>
            <Icon name="check" size={15} color={Colors.up} strokeWidth={2.2} />
            <AppText variant="caption" style={{ color: Colors.up }}>
              {added} ajoutée. Carte suivante.
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" style={styles.hint}>
            Pose la carte à plat et remplis le repère. La netteté compte moins que le cadrage.
          </AppText>
        )}

        {/* Depuis un dossier, la destination est fixée : pas de sélecteur. */}
        {lockedToFolder ? (
          <Button
            label="Changer de dossier"
            icon="folder"
            size="sm"
            variant="ghost"
            onPress={() => setUnlocked(true)}
          />
        ) : (
          <>
            <AppText variant="overline">Ranger dans</AppText>
            <FolderPicker
              folders={folders.data ?? []}
              value={targetFolder}
              onChange={setChosenFolder}
            />
          </>
        )}

        <Button
          label={targetName ? `Scanner vers « ${targetName} »` : 'Scanner la carte'}
          icon="card"
          size="lg"
          onPress={capture}
          loading={stage.step === 'working' || addScanned.isPending}
          disabled={!targetFolder}
        />

        {!targetFolder ? (
          <AppText variant="caption" style={{ color: Colors.accent }}>
            {folders.data?.length === 0
              ? 'Crée d’abord un dossier depuis l’onglet Collection.'
              : 'Choisis le dossier de destination ci-dessus.'}
          </AppText>
        ) : null}

        {scannable.length === 0 && !hashedSets.isLoading ? (
          <AppText variant="caption">
            Aucun set n&apos;est encore indexé : lance le job « Index set for scanner » sur le code
            du set voulu, sinon le scanner ne pourra rien reconnaître.
          </AppText>
        ) : null}
      </View>

      <ResultSheet
        stage={stage}
        pending={addScanned.isPending}
        onPick={addMatch}
        onClose={() => setStage({ step: 'idle' })}
      />
    </Screen>
  );
}

function FolderPicker({
  folders,
  value,
  onChange,
}: {
  folders: { id: string; name: string; color: string | null }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.folderRow}>
      {folders.map((f) => {
        const active = f.id === value;
        return (
          <Pressable
            key={f.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Ranger dans ${f.name}`}
            onPress={() => onChange(f.id)}
            style={[styles.folderChip, active && styles.folderChipActive]}>
            <View style={[styles.folderDot, { backgroundColor: f.color ?? Colors.accent }]} />
            <AppText
              variant="caption"
              numberOfLines={1}
              style={active ? { color: Colors.text, fontWeight: '600' } : undefined}>
              {f.name}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Ce que l'app a vraiment haché. Un scan raté devient lisible : soit
 *  l'image est de travers ou décadrée — c'est la géométrie —, soit elle est
 *  correcte et c'est l'index qui ne connaît pas la carte. */
function CropPreview({ uri }: { uri: string | null }) {
  if (!uri) return null;
  return (
    <View style={styles.cropWrap}>
      <Image source={{ uri }} style={styles.crop} contentFit="contain" transition={120} />
      <AppText variant="caption">Image analysée</AppText>
    </View>
  );
}

function ResultSheet({
  stage,
  pending,
  onPick,
  onClose,
}: {
  stage: Stage;
  pending: boolean;
  onPick: (m: ScanMatch) => void;
  onClose: () => void;
}) {
  const visible = stage.step === 'results' || stage.step === 'error';
  const matches = stage.step === 'results' ? stage.matches : [];
  const previewUri = stage.step === 'results' ? stage.previewUri : null;
  const nearest = stage.step === 'results' ? stage.nearest : [];
  const confidence = confidenceOf(matches);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={stage.step === 'error' ? 'Scan impossible' : 'Cette carte ?'}>
      {stage.step === 'error' ? (
        <AppText variant="body" style={{ color: Colors.danger }}>
          {stage.message}
        </AppText>
      ) : matches.length === 0 ? (
        <View style={{ gap: Space.sm }}>
          <AppText variant="body">Aucune carte connue ne correspond.</AppText>
          <CropPreview uri={previewUri} />

          {/* Le diagnostic chiffré : la distance de la plus proche dit
              laquelle des trois causes est en jeu. Sans elle, un échec
              n'apprend rien. */}
          {nearest.length > 0 ? (
            <View style={styles.nearest}>
              <AppText variant="overline">Plus proches trouvées</AppText>
              {nearest.slice(0, 3).map((m) => (
                <AppText key={m.card_id} variant="caption" numberOfLines={1}>
                  {m.distance} bits · {m.name} [{m.set_code.toUpperCase()}]
                </AppText>
              ))}
              <AppText variant="caption" style={{ color: Colors.textTertiary }}>
                {nearest[0].distance <= 22
                  ? 'Proche : la bonne carte est probablement vue, mais dégradée (reflets, angle, cadrage).'
                  : 'Loin : ce qui est analysé ne ressemble à aucune carte connue. Cadrage, orientation, ou set non indexé.'}
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" style={{ color: Colors.danger }}>
              La référence n&apos;a renvoyé aucune carte, même sans seuil. L&apos;index est
              probablement vide.
            </AppText>
          )}

          <AppText variant="caption">
            Ci-dessus, l&apos;image que l&apos;app a réellement analysée. Si ce n&apos;est pas ta
            carte bien à plat et bien cadrée, le problème est le cadrage.
          </AppText>
        </View>
      ) : (
        <View style={{ gap: Space.md }}>
          <View style={styles.confidenceLine}>
            <Diamond size={5} color={confidence === 'sure' ? Colors.up : Colors.accent} />
            <AppText variant="caption">
              {confidence === 'sure'
                ? 'Correspondance nette. Confirme d’un geste.'
                : confidence === 'likely'
                  ? 'Correspondance probable — vérifie l’illustration.'
                  : 'Peu sûr : plusieurs cartes se ressemblent ici.'}
            </AppText>
          </View>

          {confidence !== 'sure' ? <CropPreview uri={previewUri} /> : null}

          {matches.map((m, i) => (
            <Pressable
              key={m.card_id}
              accessibilityRole="button"
              accessibilityLabel={`Ajouter ${m.name}, édition ${m.set_code.toUpperCase()}`}
              disabled={pending}
              onPress={() => onPick(m)}
              style={({ pressed }) => [
                styles.matchRow,
                i === 0 && styles.matchRowBest,
                pressed && { opacity: 0.7 },
              ]}>
              <Image
                source={{ uri: m.image_small ?? undefined }}
                style={styles.matchThumb}
                contentFit="cover"
                transition={120}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="heading" numberOfLines={1}>
                  {m.name}
                </AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {m.set_code.toUpperCase()} · #{m.collector_number}
                  {m.rarity ? ` · ${m.rarity}` : ''}
                </AppText>
              </View>
              {i === 0 ? <Pill label="Meilleur" tone="accent" /> : null}
            </Pressable>
          ))}

          <AppText variant="caption">
            Aucune ne correspond ? Ferme et recadre : c&apos;est presque toujours le cadrage.
          </AppText>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  viewfinder: {
    flex: 1,
    marginHorizontal: Space.lg,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  // `pointerEvents` en style et non en prop : la prop est dépréciée depuis
  // RN 0.79. Ces deux calques sont du décor, ils ne doivent rien intercepter.
  frameLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  frame: {
    width: '82%',
    aspectRatio: CARD_ASPECT,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(239, 230, 213, 0.35)',
  },
  corner: { position: 'absolute', width: 22, height: 22, borderColor: Colors.accent },
  cornerTL: { top: -1, left: -1, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: Radius.md },
  cornerTR: { top: -1, right: -1, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: Radius.md },
  cornerBL: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: Radius.md,
  },
  cornerBR: {
    bottom: -1,
    right: -1,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: Radius.md,
  },

  working: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    pointerEvents: 'none',
  },
  workingCard: { marginBottom: Space.xl, paddingVertical: Space.sm, paddingHorizontal: Space.lg },

  diagnostic: {
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xxl,
    gap: Space.xs,
    alignItems: 'center',
  },
  bottom: { padding: Space.lg, gap: Space.md },
  hint: { textAlign: 'center' },
  addedLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm },

  folderRow: { gap: Space.sm, paddingVertical: 2 },
  folderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    height: 32,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  folderChipActive: { backgroundColor: Colors.surfaceHover, borderColor: Colors.accentBorder },
  folderDot: { width: 7, height: 7, borderRadius: 4 },

  confidenceLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  cropWrap: { alignItems: 'center', gap: Space.xs },
  nearest: {
    gap: 2,
    padding: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  crop: {
    width: 132,
    aspectRatio: CARD_ASPECT,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.rule,
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  matchRowBest: { borderColor: Colors.accentBorder },
  matchThumb: { width: 44, height: 61, borderRadius: Radius.sm, backgroundColor: Colors.surface },
});
