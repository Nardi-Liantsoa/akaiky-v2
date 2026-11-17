<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CreateFamily from '../../components/family/CreateFamily.vue'
import LoadError from '../../components/family/LoadError.vue'
import ChildAvatar from '../../components/parent/ChildAvatar.vue'
import ChildPicker from '../../components/parent/ChildPicker.vue'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { children, loadChildren, selectedChild } from '../../store/children'
import { canManage, family, loadFamily } from '../../store/family'

const t = useT()
onMounted(() => { void loadFamily() })
// Les enfants se chargent dès que la famille est connue.
watch(() => family.status, (s) => { if (s === 'ready') void loadChildren() }, { immediate: true })
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
      <template v-if="children.items.length">
        <ChildPicker />
        <article v-if="selectedChild()" class="card child">
          <ChildAvatar :name="selectedChild()!.firstName" :color="selectedChild()!.avatarColor" :size="64" />
          <h2>{{ selectedChild()!.firstName }}</h2>
          <RouterLink v-if="canManage()" class="btn btn-ghost" :to="{ name: 'enfant', params: { id: selectedChild()!.id } }">{{ t.children.edit }}</RouterLink>
        </article>
      </template>
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
.child {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}
.child h2 {
  flex: 1;
  margin: 0;
  font-size: 1.6rem;
  font-weight: 900;
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
