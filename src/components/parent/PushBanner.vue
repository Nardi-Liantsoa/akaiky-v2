<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useT } from '../../composables/useT'
import { pushBanner } from '../../lib/parentPush'
import AppIcon from '../ui/AppIcon.vue'

// Notification reçue quand l'app est au premier plan (NAR-179) : bannière en haut de l'écran,
// fermée seule après 8 s. Le texte est celui de la notification (prénom seul, jamais de
// contenu) ; la toucher ouvre le même écran qu'au toucher de la notification système.
const t = useT()
const router = useRouter()
let timer: ReturnType<typeof setTimeout> | undefined
watch(pushBanner, (b) => {
  clearTimeout(timer)
  if (b) timer = setTimeout(() => { pushBanner.value = null }, 8000)
})
onBeforeUnmount(() => clearTimeout(timer))

function open() {
  const b = pushBanner.value
  pushBanner.value = null
  if (b) void router.push(b.to)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="pushBanner" class="push-banner" role="status">
      <button type="button" class="open" @click="open">
        <strong>{{ pushBanner.title }}</strong>
        <span v-if="pushBanner.body">{{ pushBanner.body }}</span>
      </button>
      <button type="button" class="close" :aria-label="t.push.close" @click="pushBanner = null">
        <AppIcon name="cross" :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.push-banner {
  position: fixed;
  z-index: 50;
  top: calc(var(--safe-top) + var(--space-2));
  left: calc(var(--safe-left) + var(--space-3));
  right: calc(var(--safe-right) + var(--space-3));
  max-width: 560px;
  margin: 0 auto;
  display: flex;
  align-items: stretch;
  gap: var(--space-1);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 6px 24px rgb(0 0 0 / 18%);
}
.open {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: var(--tap);
  padding: var(--space-3) var(--space-4);
  border: none;
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.close {
  min-width: var(--tap);
  border: none;
  background: none;
  color: var(--text-soft);
  cursor: pointer;
}
.open:focus-visible,
.close:focus-visible {
  outline: var(--focus-ring);
  outline-offset: calc(-1 * var(--focus-offset));
}
</style>
