<script setup lang="ts">
import EmptyState from '../../components/parent/EmptyState.vue'
import { useT } from '../../composables/useT'

const t = useT()
</script>

<template>
  <EmptyState :title="t.parent.family.title" :text="t.parent.family.empty" />
</template>
