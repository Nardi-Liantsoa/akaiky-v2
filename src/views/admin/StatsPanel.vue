<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getAdminStats, type AdminStats } from '../../api/admin'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Statistiques anonymes du back-office (NAR-144) : des nombres, jamais une ligne.
const t = useT()
const stats = ref<AdminStats | null>(null)
const error = ref<unknown>(null)
async function load() {
  error.value = null
  try { stats.value = await getAdminStats() } catch (e) { error.value = e }
}
onMounted(load)
</script>

<template>
  <SectionCard :title="t.admin.stats.title" :help="t.admin.stats.help">
    <StatusBlock v-if="error" state="error" :text="errorText(error, t)" @retry="load" />
    <StatusBlock v-else-if="!stats" state="loading" />
    <dl v-else class="tiles">
      <div><dt>{{ t.admin.stats.families }}</dt><dd>{{ stats.families }}</dd></div>
      <div><dt>{{ t.admin.stats.children }}</dt><dd>{{ stats.children }}</dd></div>
      <div><dt>{{ t.admin.stats.devices }}</dt><dd>{{ stats.devices }}</dd></div>
      <div><dt>{{ t.admin.stats.active }}</dt><dd>{{ stats.activeDevices }}</dd></div>
      <div><dt>{{ t.admin.stats.silent }}</dt><dd>{{ stats.silentDevices }}</dd></div>
      <div><dt>{{ t.admin.stats.signal24h }}</dt><dd>{{ stats.devicesSignal24h }}</dd></div>
      <div>
        <dt>{{ t.admin.stats.sos }}</dt>
        <dd>{{ stats.sosThisMonth }}<small v-if="!stats.sosTracked"> · {{ t.admin.stats.sosUntracked }}</small></dd>
      </div>
    </dl>
  </SectionCard>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
  margin: 0;
}
.tiles div {
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
dt {
  color: var(--text-soft);
  font-size: 0.85rem;
}
dd {
  margin: var(--space-1) 0 0;
  font-size: 1.5rem;
  font-weight: 800;
}
dd small {
  color: var(--text-soft);
  font-size: 0.8rem;
  font-weight: 500;
}
</style>
