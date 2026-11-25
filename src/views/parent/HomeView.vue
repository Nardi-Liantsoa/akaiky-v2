<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../../components/ui/AppIcon.vue'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import { formatLongDate } from '../../lib/format'
import { auth } from '../../store/auth'
import { RouterLink } from 'vue-router'
import CreateFamily from '../../components/family/CreateFamily.vue'
import AccountSection from '../../components/parent/AccountSection.vue'
import LoadError from '../../components/family/LoadError.vue'
import ChildCards from '../../components/parent/ChildCards.vue'
import TodayLog from '../../components/parent/TodayLog.vue'
import { DESKTOP, useMediaQuery } from '../../composables/useMediaQuery'
import { locale, useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { children, loadChildren, selectedChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'
import StatusBlock from '../../components/ui/StatusBlock.vue'

const t = useT()
// Ordinateur (NAR-223, maquette 02) : cartes à gauche, journal du jour de l'enfant choisi à droite.
const desktop = useMediaQuery(DESKTOP)
const aside = computed(() => (desktop.value ? selectedChild() ?? null : null))
// Prénom du compte (premier mot du nom) et date du jour, majuscule initiale (maquettes 01 et 02).
const firstName = computed(() => auth.user?.name.trim().split(/\s+/)[0] ?? '')
// Date relue chaque minute : elle change à minuit sur une page restée ouverte.
const now = ref(new Date())
const clock = setInterval(() => { now.value = new Date() }, 60_000)
onBeforeUnmount(() => clearInterval(clock))
const today = computed(() => { const d = formatLongDate(now.value, locale.value); return d.charAt(0).toLocaleUpperCase() + d.slice(1) })
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
    <!-- En-tête (maquettes 01 et 02, NAR-227) : « Bonjour Hanta » sur téléphone (initiale du
         compte à droite, vers Mon compte), la date sur ordinateur ; puis « Vos enfants ». -->
    <header class="head">
      <div>
        <p class="over">{{ desktop ? today : t.parent.home.hello(firstName) }}</p>
        <h1>{{ t.parent.home.heading }}</h1>
      </div>
      <RouterLink v-if="desktop && family.status === 'ready' && canManage() && children.items.length" class="btn btn-ghost" :to="{ name: 'enfant-nouveau' }">
        <AppIcon name="plus" :size="20" />{{ t.children.add }}
      </RouterLink>
      <RouterLink v-else-if="!desktop && auth.user" class="me" :to="{ name: 'securite' }" :aria-label="t.parent.account.title">
        <ChildAvatar :name="auth.user.name" color="blue" :size="48" />
      </RouterLink>
    </header>
    <StatusBlock
      v-if="family.status === 'ready' && children.status === 'error'" state="error"
      :text="`${t.children.loadError} ${errorText(children.error, t)}`" @retry="loadChildren(true)"
    />
    <template v-else-if="family.status === 'ready' && children.status === 'ready'">
      <div v-if="children.items.length" class="grid" :class="{ split: aside?.phoneLastSeenAt }">
        <ChildCards :add-in-header="desktop" />
        <aside v-if="aside?.phoneLastSeenAt" class="aside">
          <TodayLog :key="aside.id" :child-id="aside.id" :title="t.parent.log.recentTitle" />
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
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: var(--space-2) 0 var(--space-4);
}
.over {
  margin: 0;
  color: var(--text-soft);
  font-size: 1.1rem;
  font-weight: 700;
}
h1 {
  margin: 0;
}
.me {
  flex: none;
  border-radius: 50%;
}
.me:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-offset);
}
/* Ordinateur : deux colonnes, le journal reste à l'écran pendant le défilement des cartes. */
/* Sans journal à côté (enfant sans téléphone) : cartes à largeur de lecture, pas étirées. */
.grid:not(.split) {
  max-width: 720px;
}
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
