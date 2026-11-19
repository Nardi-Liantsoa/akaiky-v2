<script setup lang="ts">
import { ref, watch } from 'vue'
import { setSosSiren, type Child } from '../../api/children'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { children, upsertChild } from '../../store/children'
import { canManage } from '../../store/family'

// Réglages du SOS (NAR-151) : sirène sur le téléphone de l'enfant pendant un SOS.
// Pas d'affichage anticipé : l'interrupteur suit la valeur confirmée par le serveur.
// Un contact (member) ne voit que l'état.
const props = defineProps<{ child: Child }>()
const t = useT()
const busy = ref(false)
const error = ref('')

// Autre enfant choisi : erreur effacée, interrupteur libre.
watch(() => props.child.id, () => { busy.value = false; error.value = '' })

async function toggle() {
  if (busy.value || !canManage()) return
  const child = props.child
  busy.value = true
  error.value = ''
  try {
    const res = await setSosSiren(child.id, !child.sosSiren)
    const current = children.items.find((c) => c.id === child.id)
    if (current) upsertChild({ ...current, sosSiren: res.sosSiren })
  } catch (e) {
    if (child.id === props.child.id) error.value = errorText(e, t.value)
  } finally {
    if (child.id === props.child.id) busy.value = false
  }
}
</script>

<template>
  <section id="sos" class="card sos" tabindex="-1">
    <h2>{{ t.sosSettings.title }}</h2>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="row">
      <span id="sos-siren-label" class="label">{{ t.sosSettings.siren }}</span>
      <button
        type="button" role="switch" class="toggle" aria-labelledby="sos-siren-label" aria-describedby="sos-siren-hint"
        :aria-checked="child.sosSiren" :disabled="busy || !canManage()" @click="toggle"
      ><span class="knob" /></button>
    </div>
    <p v-if="!canManage()" class="state">{{ child.sosSiren ? t.sosSettings.on : t.sosSettings.off }}</p>
    <p id="sos-siren-hint" class="hint">{{ t.sosSettings.sirenHint }}</p>
  </section>
</template>

<style scoped>
.sos {
  margin-top: 16px;
}
h2 {
  margin: 0 0 12px;
  font-size: 1.15rem;
  font-weight: 800;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: var(--tap);
}
.label {
  font-weight: 700;
}
.hint {
  margin: 4px 0 0;
  color: var(--text-soft);
}
.state {
  margin: 4px 0 0;
  font-weight: 700;
}
.toggle {
  position: relative;
  flex: none;
  width: 52px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--border-strong);
  cursor: pointer;
}
.toggle[aria-checked='true'] {
  background: var(--accent);
}
.toggle:disabled {
  cursor: default;
  opacity: 0.6;
}
.knob {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform 0.15s;
}
.toggle[aria-checked='true'] .knob {
  transform: translateX(20px);
}
.toggle:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .knob {
    transition: none;
  }
}
</style>
