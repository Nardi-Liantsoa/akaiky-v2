<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useT, locale, LOCALE_LIST } from '../../composables/useT'
import { isAdmin, logout } from '../../store/auth'
import AppButton from '../ui/AppButton.vue'
import AppIcon from '../ui/AppIcon.vue'
import FormField from '../ui/FormField.vue'
import SectionCard from '../ui/SectionCard.vue'

// « Mon compte » (NAR-156) : ce que portait l'en-tête global pour un parent connecté
// (sécurité, langue, déconnexion, administration). Sur l'écran de création de la famille,
// seul écran parent sans onglets, et dans la page du compte (NAR-209) ; l'écran Famille
// n'a plus qu'un lien vers cette page.
// onAccountPage : rendu dans la page du compte (NAR-209), sans le lien vers elle-même,
// sous le titre « Langue et session » (la page s'appelle déjà « Mon compte »).
// onboarding : écran de création de la famille (NAR-228) : la langue, puis deux liens discrets,
// « Mon compte » (sans famille ni onglets, c'est le seul accès à la sécurité, à la suppression du
// compte et, pour l'équipe, à l'administration) et « Déconnexion ».
defineProps<{ onAccountPage?: boolean, onboarding?: boolean }>()
const t = useT()
const router = useRouter()

async function onLogout() {
  await logout()
  await router.push({ name: 'accueil' })
}
</script>

<template>
  <div v-if="onboarding" class="onboarding">
    <FormField v-slot="{ control }" :label="t.parent.account.language">
      <select v-bind="control" v-model="locale" class="input">
        <option v-for="l in LOCALE_LIST" :key="l" :value="l">{{ t.lang[l] }}</option>
      </select>
    </FormField>
    <div class="onboarding-links">
      <RouterLink class="btn btn-link" :to="{ name: 'securite' }"><AppIcon name="user" :size="18" />{{ t.parent.account.title }}</RouterLink>
      <AppButton variant="link" @click="onLogout"><AppIcon name="logout" :size="18" />{{ t.parent.account.logout }}</AppButton>
    </div>
  </div>
  <SectionCard v-else :title="onAccountPage ? t.parent.account.session : t.parent.account.title" icon="globe" class="account">
    <div v-if="!onAccountPage || isAdmin()" class="links">
      <RouterLink v-if="!onAccountPage" class="link" :to="{ name: 'securite' }">
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
    <AppButton variant="ghost" block @click="onLogout"><AppIcon name="logout" :size="20" />{{ t.parent.account.logout }}</AppButton>
  </SectionCard>
</template>

<style scoped>
.onboarding {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-3);
}
.onboarding-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.onboarding .field {
  flex: 1 1 200px;
  margin-bottom: 0;
}
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
