import { ref } from 'vue'

// Confirmation à montrer sur l'écran d'arrivée après une suppression (famille ou
// compte) : une clé traduite à l'affichage, lue une fois puis effacée.
export type NoticeKey = 'familyDeleted' | 'accountDeleted'
export const notice = ref<NoticeKey | null>(null)

export function takeNotice(key: NoticeKey): boolean {
  if (notice.value !== key) return false
  notice.value = null
  return true
}
