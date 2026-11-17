<script setup lang="ts">
import { computed } from 'vue'
import { colorToken, initial, type AvatarColor } from '../../lib/avatar'

const props = withDefaults(defineProps<{ name: string, color: AvatarColor, size?: number }>(), { size: 40 })
const style = computed(() => ({ background: colorToken(props.color), width: `${props.size}px`, height: `${props.size}px`, fontSize: `${props.size * 0.45}px` }))
</script>

<template>
  <span class="avatar" :style="style" aria-hidden="true">{{ initial(name) }}</span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--on-color);
  font-weight: 900;
  line-height: 1;
}
</style>
