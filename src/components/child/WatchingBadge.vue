<script setup lang="ts">
import { useT } from '../../composables/useT'
import AppIcon from '../ui/AppIcon.vue'

// « Papa regarde où tu es » (NAR-204, maquette écran 1) : affiché pendant qu'un membre de
// la famille consulte la position de l'enfant (CdC §5.2). Noms affichés seulement.
defineProps<{ names: string[] }>()
const t = useT()
</script>

<template>
  <p class="watching" role="status">
    <AppIcon name="pin" :size="16" />
    <span>{{ t.child.watching(names) }}</span>
  </p>
</template>

<style scoped>
/* Pastille d'une ligne parmi les autres (planche 03, NAR-238). */
.watching {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 7px 12px;
  border-radius: 999px;
  background: var(--tint-sky);
  color: var(--navy);
  font-size: 0.85rem;
  font-weight: 700;
}
</style>
