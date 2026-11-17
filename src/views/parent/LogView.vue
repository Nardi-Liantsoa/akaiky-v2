<script setup lang="ts">
import EmptyState from '../../components/parent/EmptyState.vue'
import { useT } from '../../composables/useT'

const t = useT()
</script>

<template>
  <EmptyState :title="t.parent.log.title" :text="t.parent.log.empty" />
</template>
