<script setup lang="ts">
import { onMounted } from 'vue'
import EmptyState from '../../components/parent/EmptyState.vue'
import CreateFamily from '../../components/family/CreateFamily.vue'
import LoadError from '../../components/family/LoadError.vue'
import { useT } from '../../composables/useT'
import { family, loadFamily } from '../../store/family'

const t = useT()
onMounted(() => { void loadFamily() })
</script>

<template>
  <!-- Sans famille, l'accueil est l'étape de création (NAR-133). -->
  <CreateFamily v-if="family.status === 'none'" />
  <LoadError v-else-if="family.status === 'error'" />
  <EmptyState v-else :title="t.parent.home.title" :text="t.parent.home.empty" />
</template>
