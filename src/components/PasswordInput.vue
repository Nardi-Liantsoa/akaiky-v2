<script setup lang="ts">
import { ref } from 'vue'
import { useT } from '../composables/useT'

// Coller autorisé, bouton « afficher », aucune limite de longueur côté
// navigateur plus stricte que celle du serveur (200 caractères).
defineProps<{ id: string, autocomplete: 'current-password' | 'new-password' }>()
const model = defineModel<string>({ required: true })
const t = useT()
const visible = ref(false)
</script>

<template>
  <div class="pw">
    <input :id="id" v-model="model" class="input" :type="visible ? 'text' : 'password'"
      :autocomplete="autocomplete" maxlength="200" required />
    <button type="button" class="toggle" :aria-pressed="visible" @click="visible = !visible">
      {{ visible ? t.auth.hide : t.auth.show }}
    </button>
  </div>
</template>

<style scoped>
.pw {
  position: relative;
}
.pw .input {
  padding-right: 88px;
}
.toggle {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  min-height: var(--tap);
  padding: 0 8px;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
</style>
