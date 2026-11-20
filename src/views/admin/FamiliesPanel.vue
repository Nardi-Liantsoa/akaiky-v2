<script setup lang="ts">
import { onMounted } from 'vue'
import { listAdminFamilies, shortId } from '../../api/admin'
import { usePagedList } from '../../composables/usePagedList'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import AppButton from '../../components/ui/AppButton.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'

// Familles vues par l'équipe (NAR-144) : référence et nombres, jamais le nom choisi par la famille.
const t = useT()
const list = usePagedList(listAdminFamilies)
onMounted(list.reload)
// Relu par la page après un téléphone retiré (nombre de téléphones actifs, NAR-199).
defineExpose({ reload: list.reload })
</script>

<template>
  <SectionCard :title="t.admin.families.title" :help="t.admin.families.help">
    <StatusBlock v-if="list.error.value && !list.items.value.length" state="error" :text="errorText(list.error.value, t)" @retry="list.reload" />
    <StatusBlock v-else-if="!list.loaded.value" state="loading" />
    <StatusBlock v-else-if="!list.items.value.length" state="empty" :text="t.admin.families.empty" />
    <template v-else>
      <div class="admin-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>{{ t.admin.families.ref }}</th><th>{{ t.admin.families.members }}</th><th>{{ t.admin.families.children }}</th>
              <th>{{ t.admin.families.devices }}</th><th>{{ t.admin.families.created }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in list.items.value" :key="f.id">
              <td><code :title="f.id">{{ shortId(f.id) }}</code></td>
              <td>{{ f.members }}</td>
              <td>{{ f.children }}</td>
              <td>{{ f.devices }}</td>
              <td>{{ formatDateTime(f.createdAt, locale) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="list.error.value" class="error" role="alert">{{ errorText(list.error.value, t) }}</p>
      <AppButton v-if="list.next.value" variant="ghost" :disabled="list.loading.value" @click="list.more">{{ t.admin.more }}</AppButton>
    </template>
  </SectionCard>
</template>
