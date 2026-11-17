<script setup lang="ts">
import { computed } from 'vue'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { family, loadFamily } from '../../store/family'

const t = useT()
const detail = computed(() => errorText(family.error, t.value))
</script>

<template>
  <div class="error" role="alert">
    <p>{{ t.family.loadError }} {{ detail }}</p>
    <button class="btn btn-ghost" type="button" @click="loadFamily(true)">{{ t.errors.retry }}</button>
  </div>
</template>

<style scoped>
p {
  margin: 0 0 12px;
}
</style>
