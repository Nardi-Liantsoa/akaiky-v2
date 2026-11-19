<script setup lang="ts">
import { ref, watch } from 'vue'
import { setSosSiren, type Child } from '../../api/children'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { children, upsertChild } from '../../store/children'
import { canManage } from '../../store/family'
import SectionCard from '../ui/SectionCard.vue'
import ToggleSwitch from '../ui/ToggleSwitch.vue'

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
  <SectionCard id="sos" class="sos" tabindex="-1" :title="t.sosSettings.title">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <ToggleSwitch
      :model-value="child.sosSiren" :label="t.sosSettings.siren" :description="t.sosSettings.sirenHint"
      :disabled="busy || !canManage()" @update:model-value="toggle"
    />
    <p v-if="!canManage()" class="state">{{ child.sosSiren ? t.sosSettings.on : t.sosSettings.off }}</p>
  </SectionCard>
</template>

<style scoped>
.sos {
  margin-top: 16px;
}
.state {
  margin: 4px 0 0;
  font-weight: 700;
}
</style>
