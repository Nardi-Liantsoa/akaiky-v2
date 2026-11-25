import { nextTick } from 'vue'

// Formulaires (NAR-222) : le bouton d'envoi n'est jamais grisé pour une saisie incomplète.
// À l'envoi, chaque champ fautif montre son erreur (aria-invalid posé par FormField) et
// le focus va au premier, dans l'ordre du formulaire, une fois l'erreur affichée.
export async function focusFirstInvalid(form: HTMLElement | null | undefined): Promise<void> {
  await nextTick()
  const first = form?.querySelector<HTMLElement>('[aria-invalid="true"]')
  first?.focus()
}

// Longueur en caractères visibles (points de code), comme le serveur.
export const length = (v: string) => [...v.trim()].length
