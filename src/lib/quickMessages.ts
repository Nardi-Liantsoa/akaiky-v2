// Les 4 messages rapides (NAR-150) : emplacement, couleur de la maquette (écran 4).
// Textes traduits dans i18n (child.quick.texts), modifiables plus tard (NAR-173).
export type QuickSlot = 1 | 2 | 3 | 4
export const QUICK_SLOTS: readonly QuickSlot[] = [1, 2, 3, 4]
export const QUICK_TINT: Record<QuickSlot, string> = {
  1: 'var(--tint-mint)',
  2: 'var(--tint-peach)',
  3: 'var(--tint-butter)',
  4: 'var(--tint-sky)'
}
export const isQuickSlot = (v: unknown): v is QuickSlot => v === 1 || v === 2 || v === 3 || v === 4
