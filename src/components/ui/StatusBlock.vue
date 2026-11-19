<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
import { useT } from '../../composables/useT'
import AppButton from './AppButton.vue'

// Bloc d'état commun (NAR-183) : chargement, erreur de chargement, liste vide.
// - loading : anneau et texte visibles dans une zone role="status" présente dès
//   l'insertion ; le texte n'y devient visible (donc lu) qu'un instant après, car une
//   zone insérée déjà remplie n'est pas annoncée. Lu une seule fois : le texte ne change
//   plus tant que le bloc reste monté. Anneau immobile sous prefers-reduced-motion.
// - error : message et « Réessayer » (événement retry), role="alert".
// - empty : texte, et une action facultative (emplacement « action »).
// fill : hauteur réservée d'une zone de page ; card : présenté dans une carte.
export type StatusBlockState = 'loading' | 'error' | 'empty'

const props = withDefaults(defineProps<{
  state: StatusBlockState
  text?: string
  fill?: boolean
  card?: boolean
}>(), { text: '', fill: false, card: false })
const emit = defineEmits<{ retry: [] }>()
const slots = useSlots()
const t = useT()

// Délai avant de montrer le texte de chargement : la zone vide doit d'abord exister
// dans l'arbre d'accessibilité pour que son contenu soit annoncé.
const ANNOUNCE_DELAY_MS = 100
const announced = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
onMounted(() => { timer = setTimeout(() => { announced.value = true }, ANNOUNCE_DELAY_MS) })
onBeforeUnmount(() => { clearTimeout(timer) })

const message = computed(() => props.text || (props.state === 'loading' ? t.value.status.loading : ''))
const classes = computed(() => ['status-block', `is-${props.state}`, { fill: props.fill, card: props.card, error: props.state === 'error' }])
</script>

<template>
  <div v-if="state === 'loading'" :class="classes" role="status">
    <span class="spinner" aria-hidden="true" />
    <span class="label" :class="{ pending: !announced }">{{ message }}</span>
  </div>
  <div v-else-if="state === 'error'" :class="classes" role="alert">
    <p class="label">{{ message }}</p>
    <AppButton variant="ghost" @click="emit('retry')">{{ t.errors.retry }}</AppButton>
  </div>
  <div v-else :class="classes">
    <p class="label">{{ message }}</p>
    <div v-if="slots.action" class="action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.status-block {
  margin: var(--space-1) 0 var(--space-3);
}
.status-block.card,
.status-block.fill {
  margin: 0;
}
/* Même écart sous un bandeau d'erreur que la règle globale .error. */
.status-block.is-error {
  margin: 0 0 var(--space-4);
}
.is-loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap);
  color: var(--text-soft);
  font-weight: 700;
}
.is-loading.fill {
  justify-content: center;
  min-height: 30vh;
}
.pending {
  visibility: hidden;
}
.spinner {
  flex: none;
  width: var(--space-5);
  height: var(--space-5);
  border: 3px solid var(--surface-muted);
  border-top-color: var(--accent);
  border-radius: var(--radius-pill);
  animation: status-spin 0.9s linear infinite;
}
@keyframes status-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}
.label {
  margin: 0;
}
.is-error .label {
  margin: 0 0 var(--space-3);
}
.is-empty .label {
  color: var(--text-soft);
}
.action {
  margin-top: var(--space-4);
}
</style>
