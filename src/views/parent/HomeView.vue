<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CreateFamily from '../../components/family/CreateFamily.vue'
import LoadError from '../../components/family/LoadError.vue'
import ChildCards from '../../components/parent/ChildCards.vue'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { children, loadChildren } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import StatusBlock from '../../components/ui/StatusBlock.vue'

const t = useT()
onMounted(() => { void loadFamily() })
// Liste relue à chaque arrivée sur l'accueil (un autre parent a pu ajouter ou
// retirer un enfant) ; la liste connue reste affichée pendant l'appel.
watch(() => family.status, (s) => { if (s === 'ready') void loadChildren(true) }, { immediate: true })
</script>

<template>
  <!-- Sans famille, l'accueil est l'étape de création (NAR-133). -->
  <CreateFamily v-if="family.status === 'none'" />
  <LoadError v-else-if="family.status === 'error'" />
  <!-- Un seul bloc de chargement pour la famille puis les enfants : annoncé une fois. -->
  <section v-else>
    <h1>{{ t.parent.home.title }}</h1>
    <StatusBlock
      v-if="family.status === 'ready' && children.status === 'error'" state="error"
      :text="`${t.children.loadError} ${errorText(children.error, t)}`" @retry="loadChildren(true)"
    />
    <template v-else-if="family.status === 'ready' && children.status === 'ready'">
      <ChildCards v-if="children.items.length" />
      <StatusBlock v-else state="empty" card :text="canManage() ? t.children.emptyManager : t.children.emptyMember">
        <template v-if="canManage()" #action>
          <RouterLink class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
        </template>
      </StatusBlock>
    </template>
    <StatusBlock v-else state="loading" fill />
  </section>
</template>

<style scoped>
h1 {
  margin: 8px 0 16px;
}
</style>
