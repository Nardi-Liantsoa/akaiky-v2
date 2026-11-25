<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listAdminFamilies, shortId } from '../../api/admin'
import { usePagedList } from '../../composables/usePagedList'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import AppButton from '../../components/ui/AppButton.vue'
import SectionCard from '../../components/ui/SectionCard.vue'
import StatusBlock from '../../components/ui/StatusBlock.vue'
import FamilyChildren from './FamilyChildren.vue'

// Familles vues par l'équipe (NAR-144) : référence et nombres, jamais le nom choisi par la famille.
const t = useT()
const list = usePagedList(listAdminFamilies)
onMounted(list.reload)
// Enfants d'une famille ouverts sous sa ligne (NAR-200), une famille à la fois.
const open = ref<string | null>(null)
const toggle = (id: string) => { open.value = open.value === id ? null : id }
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
        <table class="admin-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">{{ t.admin.families.ref }}</th><th role="columnheader">{{ t.admin.families.members }}</th><th role="columnheader">{{ t.admin.families.children }}</th>
              <th role="columnheader">{{ t.admin.families.devices }}</th><th role="columnheader">{{ t.admin.families.created }}</th><th role="columnheader">{{ t.admin.actions }}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <template v-for="f in list.items.value" :key="f.id">
              <tr role="row">
                <td role="cell" class="lead-cell"><code :title="f.id">{{ shortId(f.id) }}</code></td>
                <td role="cell" :data-label="t.admin.families.members">{{ f.members }}</td>
                <td role="cell" :data-label="t.admin.families.children">{{ f.children }}</td>
                <td role="cell" :data-label="t.admin.families.devices">{{ f.devices }}</td>
                <td role="cell" :data-label="t.admin.families.created">{{ formatDateTime(f.createdAt, locale) }}</td>
                <td role="cell" class="actions-cell">
                  <AppButton
                    v-if="f.children" variant="ghost" small :aria-expanded="open === f.id" :aria-controls="open === f.id ? `family-kids-${f.id}` : undefined"
                    @click="toggle(f.id)"
                  >{{ open === f.id ? t.admin.kids.hide : t.admin.kids.show }}</AppButton>
                </td>
              </tr>
              <tr role="row" v-if="open === f.id" :id="`family-kids-${f.id}`">
                <td role="cell" colspan="6" class="nested-cell"><FamilyChildren :family-id="f.id" /></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <p v-if="list.error.value" class="error" role="alert">{{ errorText(list.error.value, t) }}</p>
      <AppButton v-if="list.next.value" variant="ghost" :disabled="list.loading.value" @click="list.more">{{ t.admin.more }}</AppButton>
    </template>
  </SectionCard>
</template>
