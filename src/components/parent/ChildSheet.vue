<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { pushSheet } from '../../composables/useSheetStack'
import { useT } from '../../composables/useT'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'

// Feuille du bas (NAR-174) : menu d'un enfant, liste des enfants. Rendue dans <body>
// (jamais sous l'en-tête), inscrite dans la pile des feuilles (Échap, retour Android,
// défilement bloqué), fermée aussi par le fond ou « Fermer ». Le focus y reste (Tab
// boucle dans la feuille) et revient au bouton qui l'a ouverte à la fermeture.
// opener : bouton qui a ouvert la feuille (le focus y revient ; sur iOS, un bouton
// touché ne prend pas le focus, d'où le passage explicite).
// alert : feuille de confirmation (NAR-184, ConfirmSheet), annoncée comme alertdialog ;
// son emplacement « actions » remplace le bouton « Fermer ».
// closeIcon (NAR-195, menu « ⋯ ») : petit bouton × dans l'en-tête à la place du grand
// « Fermer » du bas ; sans lui, l'apparence d'origine (sélecteur d'enfant, confirmation).
const props = defineProps<{ title: string, opener?: HTMLElement | null, alert?: boolean, closeIcon?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const t = useT()
const sheet = ref<HTMLElement | null>(null)
const opener = props.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
const pop = pushSheet(() => emit('close'))
// Focus hors de la feuille (lecteur d'écran, clic) : ramené dans la feuille.
const keepFocus = (e: FocusEvent) => { if (sheet.value && e.target instanceof Node && !sheet.value.contains(e.target)) sheet.value.focus() }
onMounted(() => {
  void nextTick(() => sheet.value?.focus())
  document.addEventListener('focusin', keepFocus)
})
onBeforeUnmount(() => {
  document.removeEventListener('focusin', keepFocus)
  pop()
  if (opener?.isConnected) opener.focus()
})

function trap(e: KeyboardEvent) {
  const focusable = sheet.value?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')
  if (!focusable?.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet.value)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
</script>

<template>
  <Teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <div ref="sheet" class="sheet" :role="alert ? 'alertdialog' : 'dialog'" aria-modal="true" :aria-label="title" tabindex="-1" @keydown.tab="trap">
        <div v-if="closeIcon" class="head">
          <h2>{{ title }}</h2>
          <button type="button" class="close-icon" :aria-label="t.children.close" @click="emit('close')">
            <AppIcon name="cross" :size="22" />
          </button>
        </div>
        <h2 v-else>{{ title }}</h2>
        <slot />
        <slot name="actions">
          <AppButton v-if="!closeIcon" variant="ghost" class="close" @click="emit('close')">{{ t.children.close }}</AppButton>
        </slot>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: color-mix(in srgb, var(--ink) 40%, transparent);
}
.sheet {
  width: min(100%, 560px);
  max-height: 80vh;
  overflow-y: auto;
  padding: 20px calc(var(--gutter) + var(--safe-right)) calc(var(--safe-bottom) + 16px) calc(var(--gutter) + var(--safe-left));
  border-radius: 24px 24px 0 0;
  background: var(--surface);
  outline: none;
}
h2 {
  margin: 0 0 12px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-2)) var(--space-3) 0;
}
.head h2 {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}
.close-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--tap);
  height: var(--tap);
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--text);
  cursor: pointer;
}
.close-icon:focus-visible {
  outline: var(--focus-ring);
  outline-offset: calc(-1 * var(--focus-offset));
}
.close {
  width: 100%;
  margin-top: 12px;
}
</style>
