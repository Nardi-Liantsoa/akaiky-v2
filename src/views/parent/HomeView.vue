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
  <section v-else-if="family.status === 'ready'">
    <h1>{{ t.parent.home.title }}</h1>
    <div v-if="children.status === 'error'" class="error" role="alert">
      <p>{{ t.children.loadError }} {{ errorText(children.error, t) }}</p>
      <button class="btn btn-ghost" type="button" @click="loadChildren(true)">{{ t.errors.retry }}</button>
    </div>
    <template v-else-if="children.status === 'ready'">
      <ChildCards v-if="children.items.length" />
      <div v-else class="card empty">
        <p>{{ canManage() ? t.children.emptyManager : t.children.emptyMember }}</p>
        <RouterLink v-if="canManage()" class="btn" :to="{ name: 'enfant-nouveau' }">{{ t.children.add }}</RouterLink>
      </div>
    </template>
    <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
  </section>
  <p v-else class="loading" role="status"><span class="visually-hidden">{{ t.family.loading }}</span></p>
</template>

<style scoped>
h1 {
  font-size: 2rem;
  margin: 8px 0 16px;
}
.empty p {
  margin: 0 0 16px;
  color: var(--text-soft);
}
.loading {
  min-height: 40vh;
  margin: 0;
}
</style>
