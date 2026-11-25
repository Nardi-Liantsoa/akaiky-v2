<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CreateFamily from '../../components/family/CreateFamily.vue'
import AccountSection from '../../components/parent/AccountSection.vue'
import LoadError from '../../components/family/LoadError.vue'
import ChildCards from '../../components/parent/ChildCards.vue'
import TodayLog from '../../components/parent/TodayLog.vue'
import { DESKTOP, useMediaQuery } from '../../composables/useMediaQuery'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { children, loadChildren, selectedChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import StatusBlock from '../../components/ui/StatusBlock.vue'

const t = useT()
// Ordinateur (NAR-223, maquette 02) : cartes à gauche, journal du jour de l'enfant choisi à droite.
const desktop = useMediaQuery(DESKTOP)
const aside = computed(() => (desktop.value ? selectedChild() ?? null : null))
onMounted(() => { void loadFamily() })
// Liste relue à chaque arrivée sur l'accueil (un autre parent a pu ajouter ou
// retirer un enfant) ; la liste connue reste affichée pendant l'appel.
watch(() => family.status, (s) => { if (s === 'ready') void loadChildren(true) }, { immediate: true })
</script>

<template>
  <!-- Sans famille, l'accueil est l'étape de création (NAR-133). -->
  <!-- Seul écran parent sans onglets : « Mon compte » y reste atteignable (NAR-156). -->
  <template v-if="family.status === 'none'">
    <CreateFamily />
    <AccountSection class="account" />
  </template>
  <LoadError v-else-if="family.status === 'error'" />
  <!-- Un seul bloc de chargement pour la famille puis les enfants : annoncé une fois. -->
  <section v-else>
    <h1>{{ t.parent.home.title }}</h1>
    <StatusBlock
      v-if="family.status === 'ready' && children.status === 'error'" state="error"
      :text="`${t.children.loadError} ${errorText(children.error, t)}`" @retry="loadChildren(true)"
    />
    <template v-else-if="family.status === 'ready' && children.status === 'ready'">
      <div v-if="children.items.length" class="grid" :class="{ split: aside?.phoneLastSeenAt }">
        <ChildCards :today-aside="aside?.phoneLastSeenAt ? aside.id : null" />
        <aside v-if="aside?.phoneLastSeenAt" class="aside">
          <TodayLog :key="aside.id" :child-id="aside.id" />
        </aside>
      </div>
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
/* Ordinateur : deux colonnes, le journal reste à l'écran pendant le défilement des cartes. */
.grid.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 400px);
  align-items: start;
  gap: var(--space-5);
}
.aside {
  position: sticky;
  top: var(--space-5);
}
.aside > :deep(*) {
  margin-top: 0;
}
.account {
  margin-top: 28px;
}
</style>
