<script setup lang="ts">
import EmptyState from '../../components/parent/EmptyState.vue'
import { useT } from '../../composables/useT'

const t = useT()
</script>

<template>
  <EmptyState :title="t.parent.settings.title" :text="t.parent.settings.empty" />
</template>
