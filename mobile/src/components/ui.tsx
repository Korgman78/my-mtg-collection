// Primitives visuelles de Grimoire.
//
// Tout écran se compose à partir d'ici : aucun écran ne redéclare une couleur,
// une hauteur de bouton ou un rayon. Si un besoin n'est pas couvert, on ajoute
// une primitive ici plutôt qu'un style local.
//
// Deux règles d'accessibilité tenues par ces composants :
//   - un contrôle tactile fait au moins 40 px de haut ;
//   - une icône seule porte toujours un libellé (`label`), jamais rien de muet.
//
// Une règle de structure, apprise à la dure : un contrôle ne s'imbrique jamais
// dans un autre contrôle. Sur le web, `accessibilityRole="button"` produit un
// vrai `<button>`, et un `<button>` dans un `<button>` est du HTML invalide.
// Une ligne cliquable qui porte une action secondaire se compose donc en deux
// zones sœurs (voir `FolderRow` dans le tableau de bord), pas en poupées russes.

import { type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
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

import { Icon, type IconName } from '@/components/icons';
import { Colors, Control, Fonts, MaxContentWidth, Radius, Space } from '@/constants/theme';

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

/** Cadre commun d'un écran.
 *
 *  Le bas n'est pas protégé par défaut, et c'est voulu : sous un écran à
 *  onglets, c'est la barre d'onglets qui occupe la zone système, et réserver
 *  l'inset ici creuserait un vide au-dessus d'elle. Les écrans empilés qui
 *  ancrent un contrôle en bas (`marginTop: 'auto'`) passent `safeBottom` —
 *  sans quoi le contrôle se glisse sous les boutons de navigation Android.
 *  Une liste qui défile n'en a pas besoin : sa marge basse suffit. */
export function Screen({
  children,
  style,
  safeBottom = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  safeBottom?: boolean;
}) {
  return (
    <View style={styles.screenRoot}>
      <SafeAreaView
        style={styles.safe}
        edges={safeBottom ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right']}>
        <View style={[styles.screenBody, style]}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

/** Barre de tête commune : retour, titre, sous-titre, actions à droite. */
export function AppBar({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.appBar}>
      {onBack ? <IconButton name="chevronLeft" label="Retour" onPress={onBack} /> : null}
      <View style={styles.appBarTitles}>
        <AppText variant="heading" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ? <View style={styles.appBarActions}>{right}</View> : null}
    </View>
  );
}

/** Losange doré. Marque d'enluminure, jamais porteuse de sens seule. */
export function Diamond({ size = 5, color = Colors.accent }: { size?: number; color?: string }) {
  return <View style={[styles.diamond, { width: size, height: size, backgroundColor: color }]} />;
}

/** Titre de section : losange, titre gravé, filet doré qui court jusqu'à
 *  l'action. C'est la rubrique d'un chapitre, pas une étiquette de formulaire. */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; icon?: IconName; onPress: () => void };
}) {
  return (
    <View style={styles.sectionHeader}>
      <Diamond />
      <AppText variant="overline">{title}</AppText>
      <View style={styles.sectionRule} />
      {action ? (
        <Button
          label={action.label}
          icon={action.icon}
          onPress={action.onPress}
          variant="secondary"
          size="sm"
        />
      ) : null}
    </View>
  );
}

/** Filet de séparation. `ornament` place un losange en son milieu, pour les
 *  respirations franches (fin de bloc), pas pour séparer deux lignes de liste. */
export function Divider({
  ornament = false,
  style,
}: {
  ornament?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!ornament) return <View style={[styles.divider, style]} />;
  return (
    <View style={[styles.dividerOrnate, style]}>
      <View style={styles.dividerLine} />
      <Diamond size={4} color={Colors.borderStrong} />
      <View style={styles.dividerLine} />
    </View>
  );
}

/** Panneau. `tone="plate"` ajoute la bordure dorée et les équerres d'angle :
 *  c'est l'enluminure de l'app, réservée à UN bloc par écran (celui qu'on
 *  regarde en premier). Deux plaques sur un même écran et plus rien ne prime. */
export function Surface({
  children,
  style,
  padded = true,
  tone = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  tone?: 'default' | 'plate';
}) {
  return (
    <View
      style={[styles.surface, tone === 'plate' && styles.plate, padded && styles.surfacePadded, style]}>
      {tone === 'plate' ? <GiltCorners /> : null}
      {children}
    </View>
  );
}

/** Équerres d'angle dorées, dessinées en bordures plutôt qu'en SVG : quatre
 *  vues suffisent, et un trait de 1 px reste net à toutes les densités. */
function GiltCorners() {
  return (
    <>
      <View style={[styles.corner, styles.cornerTL]} />
      <View style={[styles.corner, styles.cornerTR]} />
      <View style={[styles.corner, styles.cornerBL]} />
      <View style={[styles.corner, styles.cornerBR]} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Texte                                                                       */
/* -------------------------------------------------------------------------- */

type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'label'
  | 'caption'
  | 'overline'
  | 'price'
  | 'mono';

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

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const tint =
    variant === 'primary'
      ? Colors.onAccent
      : variant === 'danger'
        ? Colors.danger
        : Colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { height: Control[size], paddingHorizontal: size === 'sm' ? Space.md : Space.lg },
        variantStyles[variant],
        pressed && !inactive && styles.buttonPressed,
        inactive && styles.buttonDisabled,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} color={tint} /> : null}
          <Text style={[styles.buttonLabel, size === 'sm' && styles.buttonLabelSm, { color: tint }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Bouton icône. `label` est obligatoire : pas de contrôle muet dans l'app. */
export function IconButton({
  name,
  label,
  onPress,
  variant = 'ghost',
  size = 'md',
  badge,
  tint,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'solid' | 'danger';
  size?: 'sm' | 'md';
  badge?: number;
  tint?: string;
}) {
  const dimension = size === 'sm' ? Control.sm : Control.md;
  const color =
    tint ?? (variant === 'solid' ? Colors.onAccent : variant === 'danger' ? Colors.danger : Colors.textSecondary);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        { width: dimension, height: dimension },
        variant === 'solid' && styles.iconButtonSolid,
        variant === 'ghost' && styles.iconButtonGhost,
        variant === 'danger' && styles.iconButtonDanger,
        pressed && styles.buttonPressed,
      ]}>
      <Icon name={name} size={size === 'sm' ? 16 : 19} color={color} />
      {badge && badge > 0 ? (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Groupe de choix exclusifs. Remplace les rangées de Pressable ad hoc. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: boolean;
}) {
  return (
    <View style={[styles.segmented, columns && styles.segmentedWrap]}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.segment,
              columns && styles.segmentColumn,
              active && styles.segmentActive,
              pressed && styles.buttonPressed,
            ]}>
            <Text
              numberOfLines={1}
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Incrémenteur de quantité. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 999,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <View style={styles.stepper}>
      <IconButton
        name="minus"
        label="Diminuer la quantité"
        onPress={() => onChange(Math.max(min, value - 1))}
      />
      <Text style={styles.stepperValue}>{value}</Text>
      <IconButton
        name="plus"
        label="Augmenter la quantité"
        onPress={() => onChange(Math.min(max, value + 1))}
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Saisie                                                                      */
/* -------------------------------------------------------------------------- */

export function TextField({
  label,
  icon,
  error,
  right,
  ...props
}: TextInputProps & {
  label?: string;
  icon?: IconName;
  error?: string;
  /** Contrôle posé dans le champ, à droite — un bouton d'effacement, par
   *  exemple. Android n'a pas d'équivalent au `clearButtonMode` d'iOS : sans
   *  ça, on ne vide un champ qu'à la touche retour arrière. */
  right?: ReactNode;
}) {
  return (
    <View style={{ gap: Space.xs }}>
      {label ? <AppText variant="label">{label}</AppText> : null}
      <View style={[styles.inputWrap, error ? styles.inputWrapError : null]}>
        {icon ? (
          <View style={styles.inputIcon}>
            <Icon name={icon} size={17} color={Colors.textTertiary} />
          </View>
        ) : null}
        <TextInput
          placeholderTextColor={Colors.textTertiary}
          {...props}
          style={[styles.input, icon ? styles.inputWithIcon : null, props.style]}
        />
        {right ? <View style={styles.inputRight}>{right}</View> : null}
      </View>
      {error ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: Space.sm }}>
      <AppText variant="label">{label}</AppText>
      {children}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Indicateurs                                                                 */
/* -------------------------------------------------------------------------- */

/** Variation de prix. Neutre à 0 % : une variation nulle n'est pas une hausse. */
export function ChangeBadge({ pct, size = 'md' }: { pct: number | null | undefined; size?: 'sm' | 'md' }) {
  if (pct === null || pct === undefined) return null;
  const up = pct > 0;
  const flat = pct === 0;
  const color = flat ? Colors.textSecondary : up ? Colors.up : Colors.down;

  return (
    <View style={[styles.badge, size === 'sm' && styles.badgeSm]}>
      {!flat ? <Icon name={up ? 'arrowUp' : 'arrowDown'} size={11} color={color} strokeWidth={2.2} /> : null}
      <Text style={[styles.badgeText, size === 'sm' && styles.badgeTextSm, { color }]}>
        {Math.abs(pct).toFixed(1).replace('.', ',')} %
      </Text>
    </View>
  );
}

export function FinishBadge({ finish }: { finish: string }) {
  if (finish === 'nonfoil') return null;
  return (
    <View style={[styles.badge, styles.badgeFoil]}>
      <Icon name="sparkle" size={11} color={Colors.foil} strokeWidth={1.8} />
      <Text style={[styles.badgeText, { color: Colors.foil }]}>
        {finish === 'foil' ? 'Foil' : 'Etched'}
      </Text>
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }) {
  return (
    <View style={[styles.pill, tone === 'accent' && styles.pillAccent]}>
      <Text style={[styles.pillText, tone === 'accent' && { color: Colors.accent }]}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* États                                                                       */
/* -------------------------------------------------------------------------- */

/** État vide. `action` est fortement recommandée : un écran vide sans porte
 *  de sortie est la première cause de blocage utilisateur. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  action?: { label: string; icon?: IconName; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={22} color={Colors.textTertiary} />
      </View>
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {hint ? (
        <AppText variant="body" style={styles.emptyHint}>
          {hint}
        </AppText>
      ) : null}
      {action ? (
        <Button
          label={action.label}
          icon={action.icon}
          onPress={action.onPress}
          style={{ marginTop: Space.sm }}
        />
      ) : null}
    </View>
  );
}

/** Écran d'échec de chargement.
 *
 *  Existe parce qu'un `if (isLoading || !data) return <Loading />` transforme
 *  toute erreur en spinner éternel : le 2026-08-19, le tableau de bord a tourné
 *  dans le vide une matinée entière alors que le serveur répondait un 400 franc
 *  et immédiat. Une requête qui échoue doit le dire, et proposer de réessayer.
 *
 *  `detail` porte le message technique. On l'affiche — c'est une app qu'on
 *  s'écrit à soi-même, et un message brut vaut mieux qu'un « oups » poli. */
export function ErrorState({
  title = 'Chargement impossible',
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, styles.errorIcon]}>
        <Icon name="alert" size={22} color={Colors.danger} />
      </View>
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {detail ? (
        <AppText variant="caption" style={styles.errorDetail}>
          {detail}
        </AppText>
      ) : null}
      {onRetry ? (
        <Button label="Réessayer" onPress={onRetry} style={{ marginTop: Space.sm }} />
      ) : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={Colors.textTertiary} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Feuille modale                                                              */
/* -------------------------------------------------------------------------- */

/** Conteneur modal commun : voile, panneau ancré en bas, tête avec fermeture. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHeader}>
            <AppText variant="heading" numberOfLines={1} style={{ flex: 1 }}>
              {title}
            </AppText>
            <IconButton name="close" label="Fermer" onPress={onClose} />
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Confirmation                                                                */
/* -------------------------------------------------------------------------- */

/** Confirmation d'une action irréversible.
 *
 *  Pourquoi pas `Alert.alert` : sur react-native-web c'est une méthode vide
 *  (`static alert() {}`). Le bouton se cliquait, aucune boîte ne s'ouvrait,
 *  et donc rien n'était jamais supprimé — silencieusement. Cette boîte-ci
 *  rend le même service sur les trois plateformes.
 *
 *  L'action destructrice n'est jamais présélectionnée et son libellé nomme
 *  l'acte (« Supprimer le dossier »), jamais « OK ». */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Annuler',
  destructive = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.dialogBackdrop} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={() => {}}>
          <View style={styles.dialogHead}>
            <View
              style={[styles.dialogGlyph, destructive && { backgroundColor: Colors.dangerSoft }]}>
              <Icon
                name={destructive ? 'trash' : 'check'}
                size={18}
                color={destructive ? Colors.danger : Colors.accent}
              />
            </View>
            <AppText variant="heading">{title}</AppText>
          </View>

          {message ? (
            <AppText variant="body" style={styles.dialogMessage}>
              {message}
            </AppText>
          ) : null}

          <View style={styles.dialogActions}>
            <Button
              label={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              style={styles.dialogAction}
            />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
              loading={loading}
              style={styles.dialogAction}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.accent },
  secondary: {
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  danger: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dangerBorder,
  },
});

const styles = StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: Colors.bg },
  safe: { flex: 1 },
  screenBody: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },

  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    minHeight: 56,
  },
  appBarTitles: { flex: 1, gap: 1 },
  appBarActions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: Control.sm,
  },
  sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.rule },
  diamond: { transform: [{ rotate: '45deg' }] },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  dividerOrnate: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },

  surface: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  surfacePadded: { padding: Space.lg },
  plate: {
    borderColor: Colors.rule,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderColor: Colors.accentBorder,
    // Décor pur : ne doit jamais intercepter un geste. En style et non en
    // prop — `props.pointerEvents` est déprécié depuis RN 0.79.
    pointerEvents: 'none',
  },
  cornerTL: { top: 6, left: 6, borderTopWidth: 1, borderLeftWidth: 1, borderTopLeftRadius: Radius.sm },
  cornerTR: { top: 6, right: 6, borderTopWidth: 1, borderRightWidth: 1, borderTopRightRadius: Radius.sm },
  cornerBL: {
    bottom: 6,
    left: 6,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderBottomLeftRadius: Radius.sm,
  },
  cornerBR: {
    bottom: 6,
    right: 6,
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderBottomRightRadius: Radius.sm,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    borderRadius: Radius.md,
  },
  buttonPressed: { opacity: 0.72 },
  buttonDisabled: { opacity: 0.38 },
  buttonLabel: { fontSize: 15, fontWeight: '600', fontFamily: Fonts?.sans, letterSpacing: -0.1 },
  buttonLabelSm: { fontSize: 13 },

  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    position: 'relative',
  },
  iconButtonGhost: { backgroundColor: 'transparent' },
  iconButtonSolid: { backgroundColor: Colors.accent },
  iconButtonDanger: { backgroundColor: Colors.dangerSoft },
  iconBadge: {
    position: 'absolute',
    top: 3,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.bg,
  },
  iconBadgeText: { color: Colors.onAccent, fontSize: 10, fontWeight: '700' },

  segmented: {
    flexDirection: 'row',
    gap: Space.xs,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    padding: 3,
  },
  segmentedWrap: { flexWrap: 'wrap', backgroundColor: 'transparent', padding: 0, gap: Space.sm },
  segment: {
    flex: 1,
    minHeight: Control.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
  },
  segmentColumn: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: Control.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  segmentActive: {
    backgroundColor: Colors.surfaceHover,
    borderColor: Colors.borderStrong,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
    fontFamily: Fonts?.sans,
    textAlign: 'center',
  },
  segmentLabelActive: { color: Colors.text, fontWeight: '600' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  stepperValue: {
    minWidth: 40,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
    fontFamily: Fonts?.sans,
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    height: Control.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  inputWrapError: { borderColor: Colors.dangerBorder },
  inputIcon: { paddingLeft: Space.md },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: Space.md,
    color: Colors.text,
    fontSize: 15,
    fontFamily: Fonts?.sans,
  },
  inputWithIcon: { paddingLeft: Space.sm },
  inputRight: { paddingRight: Space.xs },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: Radius.sm,
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    backgroundColor: Colors.surfaceAlt,
    alignSelf: 'flex-start',
  },
  badgeSm: { paddingHorizontal: 5, paddingVertical: 2 },
  badgeFoil: { backgroundColor: Colors.foilSoft },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    fontFamily: Fonts?.sans,
  },
  badgeTextSm: { fontSize: 11 },

  pill: {
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    backgroundColor: Colors.surfaceAlt,
    alignSelf: 'flex-start',
  },
  pillAccent: { backgroundColor: Colors.accentSoft },
  pillText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, fontFamily: Fonts?.sans },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.xl,
    paddingVertical: Space.xxxl,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.xs,
  },
  emptyHint: { textAlign: 'center', color: Colors.textSecondary, maxWidth: 320 },
  errorIcon: { backgroundColor: Colors.dangerSoft, borderColor: Colors.dangerBorder },
  errorDetail: { textAlign: 'center', color: Colors.textSecondary, maxWidth: 320 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },

  sheetBackdrop: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderStrong,
    maxHeight: '88%',
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingLeft: Space.xl,
    paddingRight: Space.md,
    paddingVertical: Space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  sheetBody: { padding: Space.xl, gap: Space.xl },
  sheetFooter: {
    padding: Space.xl,
    paddingTop: Space.lg,
    gap: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },

  dialogBackdrop: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    gap: Space.md,
    padding: Space.xl,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.rule,
  },
  dialogHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  dialogGlyph: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogMessage: { color: Colors.textSecondary },
  dialogActions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.xs },
  dialogAction: { flex: 1 },
});

const textStyles = StyleSheet.create({
  display: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Fonts?.sans,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Fonts?.sans,
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    fontFamily: Fonts?.sans,
    letterSpacing: -0.2,
  },
  body: { fontSize: 15, color: Colors.text, fontFamily: Fonts?.sans, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, fontFamily: Fonts?.sans },
  caption: { fontSize: 12.5, color: Colors.textSecondary, fontFamily: Fonts?.sans },
  // Rubrique gravée : petite, dorée, très espacée. C'est le seul endroit où
  // l'or porte du texte — ailleurs il ne sert qu'aux actions.
  overline: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.accent,
    fontFamily: Fonts?.sans,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  price: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
    fontFamily: Fonts?.sans,
    fontVariant: ['tabular-nums'],
  },
  mono: { fontSize: 12.5, color: Colors.textSecondary, fontFamily: Fonts?.mono },
});
