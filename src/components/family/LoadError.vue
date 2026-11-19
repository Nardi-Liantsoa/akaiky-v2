<script setup lang="ts">
import { computed } from 'vue'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { family, loadFamily } from '../../store/family'
import AppButton from '../ui/AppButton.vue'

const t = useT()
const detail = computed(() => errorText(family.error, t.value))
</script>

<template>
  <div class="error" role="alert">
    <p>{{ t.family.loadError }} {{ detail }}</p>
    <AppButton variant="ghost" @click="loadFamily(true)">{{ t.errors.retry }}</AppButton>
  </div>
</template>

<style scoped>
p {
  margin: 0 0 12px;
}
</style>
