<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useT, locale, LOCALE_LIST } from '../../composables/useT'
import { isAdmin, logout } from '../../store/auth'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'
import FormField from '../ui/FormField.vue'
import SectionCard from '../ui/SectionCard.vue'

// « Mon compte » (NAR-156) : ce que portait l'en-tête global pour un parent connecté
// (sécurité, langue, déconnexion, administration), dans l'onglet Famille et sur
// l'écran de création de la famille, seul écran parent sans onglets.
const t = useT()
const router = useRouter()

async function onLogout() {
  await logout()
  await router.push({ name: 'accueil' })
}
</script>

<template>
  <SectionCard :title="t.parent.account.title" class="account">
    <div class="links">
      <RouterLink class="link" :to="{ name: 'securite' }">
        <span>{{ t.parent.account.security }}</span>
        <AppIcon name="chevron-right" :size="20" />
      </RouterLink>
      <RouterLink v-if="isAdmin()" class="link" :to="{ name: 'admin' }">
        <span>{{ t.parent.account.admin }}</span>
        <AppIcon name="chevron-right" :size="20" />
      </RouterLink>
    </div>
    <FormField v-slot="{ control }" :label="t.parent.account.language">
      <select v-bind="control" v-model="locale" class="input">
        <option v-for="l in LOCALE_LIST" :key="l" :value="l">{{ t.lang[l] }}</option>
      </select>
    </FormField>
    <AppButton variant="ghost" block @click="onLogout">{{ t.parent.account.logout }}</AppButton>
  </SectionCard>
</template>

<style scoped>
.links {
  margin: 0 0 var(--space-3);
}
.link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--tap);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}
.link :deep(svg) {
  color: var(--text-soft);
}
</style>
