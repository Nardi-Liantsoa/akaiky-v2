<script setup lang="ts">
import AppIcon from '../ui/AppIcon.vue'
import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { exportFamily } from '../../api/families'
import { ApiError } from '../../api/http'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { loadFamily } from '../../store/family'
import AppButton from '../ui/AppButton.vue'
import SectionCard from '../ui/SectionCard.vue'

// Export des données de la famille (NAR-178, droit d'accès), sur l'écran Famille (NAR-209) :
// monté pour owner et manager seulement, le serveur refuse les autres.
// Fichier construit par le serveur, enregistré par un lien de téléchargement temporaire.
// Pas d'export dans l'app native : la WebView ignore ce téléchargement (Filesystem/Share
// demanderait une nouvelle coque) ; on renvoie vers la version web.
defineProps<{ bare?: boolean }>()
const t = useT()
const nativeApp = Capacitor.isNativePlatform()
const exporting = ref(false)
const exportError = ref('')

async function downloadExport() {
  if (nativeApp || exporting.value) return
  exporting.value = true
  exportError.value = ''
  try {
    const data = await exportFamily()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `akaiky-famille-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (e) {
    exportError.value = e instanceof ApiError && e.status === 429 ? t.value.dataExport.tooMany : errorText(e, t.value)
    if (e instanceof ApiError && e.code === 'family_role') void loadFamily(true)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <!-- bare : sans carte ni titre, dans une section repliable de la page Famille (NAR-228). -->
  <div v-if="bare" class="export-bare">
    <p class="help">{{ t.dataExport.lead }}</p>
    <p v-if="nativeApp" class="help">{{ t.dataExport.nativeHint }}</p>
    <template v-else>
      <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>
      <AppButton variant="ghost" small :disabled="exporting" @click="downloadExport"><AppIcon name="download" :size="18" />{{ exporting ? t.dataExport.busy : t.dataExport.action }}</AppButton>
    </template>
  </div>
  <SectionCard v-else :title="t.dataExport.title" :help="t.dataExport.lead">
    <p v-if="nativeApp" class="help">{{ t.dataExport.nativeHint }}</p>
    <template v-else>
      <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>
      <AppButton variant="ghost" small :disabled="exporting" @click="downloadExport"><AppIcon name="download" :size="18" />{{ exporting ? t.dataExport.busy : t.dataExport.action }}</AppButton>
    </template>
  </SectionCard>
</template>

<style scoped>
/* Dans la page Famille (NAR-228) : texte à gauche, « Exporter » à droite ; l'un sous l'autre
 * si la place manque. */
.export-bare {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.export-bare .help {
  flex: 1 1 220px;
  margin: 0;
}
.export-bare .error {
  flex: 1 0 100%;
  order: 3;
  margin: 0;
}
</style>
