<script setup lang="ts">
// Icône d'un message rapide (NAR-150, maquette écran 4) : maison, voiture, horloge, sourire.
// Lisible sans savoir lire ; même icône chez l'enfant et chez les parents.
defineProps<{ kind: 1 | 2 | 3 | 4, size?: number }>()
</script>

<template>
  <svg :width="size ?? 40" :height="size ?? 40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="kind === 1"><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></template>
    <template v-else-if="kind === 2"><path d="M5 16l1.5-6h11L19 16" /><rect x="3" y="16" width="18" height="4" rx="1" /><circle cx="7.5" cy="20" r="1.5" /><circle cx="16.5" cy="20" r="1.5" /></template>
    <template v-else-if="kind === 3"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></template>
    <template v-else><circle cx="12" cy="12" r="9" /><path d="M8 14a5 5 0 0 0 8 0" /><path d="M9 9.5h.01M15 9.5h.01" /></template>
  </svg>
</template>
