<script setup lang="ts">
import { computed } from 'vue'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { family, loadFamily } from '../../store/family'
import StatusBlock from '../ui/StatusBlock.vue'

// Famille impossible à charger : bloc d'erreur commun (NAR-183) avec « Réessayer ».
const t = useT()
const text = computed(() => `${t.value.family.loadError} ${errorText(family.error, t.value)}`)
</script>

<template>
  <StatusBlock state="error" :text="text" @retry="loadFamily(true)" />
</template>
