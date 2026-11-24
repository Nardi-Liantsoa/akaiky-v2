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
    <AppIcon name="pin" :size="20" />
    <span>{{ t.child.watching(names) }}</span>
  </p>
</template>

<style scoped>
.watching {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 14px;
  border-radius: 999px;
  background: var(--tint-sky);
  color: var(--navy);
  font-weight: 600;
  align-self: center;
}
</style>
