<script setup lang="ts">
// Icône d'un message rapide (NAR-150, maquette écran 4) : maison, voiture, horloge, sourire.
// Lisible sans savoir lire ; même icône chez l'enfant et chez les parents. Tracés du jeu
// commun (AppIcon), toujours décoratifs : le texte du message est écrit à côté.
import AppIcon from '../ui/AppIcon.vue'
import type { IconName } from '../ui/icons'

defineProps<{ kind: 1 | 2 | 3 | 4, size?: number }>()
const NAMES = { 1: 'quick-home', 2: 'car', 3: 'clock', 4: 'smile' } as const satisfies Record<1 | 2 | 3 | 4, IconName>
</script>

<template>
  <AppIcon :name="NAMES[kind]" :size="size ?? 40" />
</template>
