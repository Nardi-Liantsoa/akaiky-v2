<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getApps, setAllowedApps, type ChildApps } from '../../api/apps'
import { ApiError } from '../../api/http'
import { useT } from '../../composables/useT'
import { errorText } from '../../lib/errors'
import { canManage } from '../../store/family'
import AppButton from '../ui/AppButton.vue'
import StatusBlock from '../ui/StatusBlock.vue'

// Applications autorisées sur le téléphone de l'enfant (NAR-143, maquette écran 8) : puces
// « ✓ Appareil photo », « + Ajouter » ouvre la liste des applications envoyée par le
// téléphone. 4 au plus. Un contact (member) voit la liste sans pouvoir la changer. Pas
// d'affichage anticipé : la liste suit la réponse du serveur.
const props = defineProps<{ childId: string }>()
const t = useT()

const data = ref<ChildApps | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
// Deux erreurs distinctes, jamais affichées ensemble : celle du chargement (avec
// « Réessayer ») l'emporte sur celle de la dernière action.
const loadError = ref('')
const error = ref('')
const busy = ref(false)
const picking = ref(false)

let loadId = 0
async function load(childId: string) {
  const id = ++loadId
  status.value = 'loading'
  try {
    const res = await getApps(childId)
    if (id !== loadId) return
    data.value = res
    status.value = 'ready'
  } catch (e) {
    if (id !== loadId) return
    loadError.value = errorText(e, t.value)
    status.value = 'error'
  }
}
// Autre enfant : liste fermée, erreur effacée, données relues.
watch(() => props.childId, (id) => { picking.value = false; error.value = ''; busy.value = false; data.value = null; void load(id) }, { immediate: true })

const max = computed(() => data.value?.max ?? 4)
const allowed = computed(() => data.value?.allowed ?? [])
const icons = computed(() => new Map((data.value?.inventory ?? []).map((a) => [a.package, a.icon])))
const addable = computed(() => (data.value?.inventory ?? []).filter((a) => !a.allowed))
const full = computed(() => allowed.value.length >= max.value)

function messageOf(e: unknown) {
  const errs = t.value.allowedApps.errors
  if (e instanceof ApiError && e.code && e.code in errs) {
    const text = errs[e.code as keyof typeof errs]
    // Paquet nommé par le serveur : son nom affiché (liste autorisée ou inventaire), sinon le paquet.
    if (!e.pkg) return text
    const name = allowed.value.find((a) => a.package === e.pkg)?.label ?? data.value?.inventory.find((a) => a.package === e.pkg)?.label ?? e.pkg
    return t.value.allowedApps.refused(name, text)
  }
  return errorText(e, t.value)
}

async function save(packages: string[]) {
  if (busy.value || !canManage()) return
  const childId = props.childId
  busy.value = true
  error.value = ''
  try {
    await setAllowedApps(childId, packages)
    if (childId !== props.childId) return
    picking.value = false
    // Relu : drapeaux « autorisée » de l'inventaire et liste à jour, en une seule source.
    await load(childId)
  } catch (e) {
    if (childId === props.childId) error.value = messageOf(e)
  } finally {
    if (childId === props.childId) busy.value = false
  }
}
const add = (pkg: string) => save([...allowed.value.map((a) => a.package), pkg])
const remove = (pkg: string) => save(allowed.value.map((a) => a.package).filter((p) => p !== pkg))
</script>

<template>
  <section id="applications" class="card apps" tabindex="-1">
    <div class="head">
      <h2>{{ t.allowedApps.title }}</h2>
      <span v-if="data" class="count">{{ t.allowedApps.count(allowed.length, max) }}</span>
    </div>
    <p class="hint">{{ t.allowedApps.hint(max) }}</p>
    <StatusBlock v-if="status === 'error'" state="error" :text="`${t.allowedApps.loadError} ${loadError}`" @retry="load(childId)" />
    <p v-else-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="data">
      <ul v-if="allowed.length" class="chips">
        <li v-for="a in allowed" :key="a.package" class="chip" :class="{ blocked: a.blocked }">
          <img v-if="icons.get(a.package)" :src="`data:image/png;base64,${icons.get(a.package)}`" alt="" width="20" height="20">
          <span v-if="a.blocked">{{ t.allowedApps.blocked(a.label) }}</span>
          <span v-else>✓ {{ a.label }}</span>
          <button v-if="canManage()" class="remove" type="button" :aria-label="t.allowedApps.remove(a.label)" :disabled="busy" @click="remove(a.package)">✕</button>
        </li>
        <li v-if="canManage() && data.inventory.length && !full" class="chip-add">
          <button class="chip add" type="button" :aria-expanded="picking" aria-controls="apps-picker" :disabled="busy" @click="picking = !picking">{{ t.allowedApps.add }}</button>
        </li>
      </ul>
      <StatusBlock v-else state="empty" :text="data.inventory.length ? t.allowedApps.none : t.allowedApps.noInventory">
        <template v-if="canManage() && data.inventory.length" #action>
          <button class="chip add" type="button" :aria-expanded="picking" aria-controls="apps-picker" :disabled="busy" @click="picking = !picking">{{ t.allowedApps.add }}</button>
        </template>
      </StatusBlock>
      <p v-if="canManage() && full" class="state">{{ t.allowedApps.full(max) }}</p>
      <div v-if="picking && canManage() && !full" id="apps-picker" class="picker" role="group" :aria-label="t.allowedApps.pickerTitle">
        <div class="picker-head">
          <h3>{{ t.allowedApps.pickerTitle }}</h3>
          <AppButton variant="ghost" @click="picking = false">{{ t.allowedApps.close }}</AppButton>
        </div>
        <StatusBlock v-if="!addable.length" state="empty" :text="t.allowedApps.nothingToAdd" />
        <ul v-else class="choices">
          <li v-for="a in addable" :key="a.package">
            <button class="choice" type="button" :disabled="busy" @click="add(a.package)">
              <img v-if="a.icon" :src="`data:image/png;base64,${a.icon}`" alt="" width="32" height="32">
              <span v-else class="glyph" aria-hidden="true">{{ [...a.label][0] }}</span>
              <span>{{ a.label }}</span>
            </button>
          </li>
        </ul>
      </div>
    </template>
    <StatusBlock v-else-if="status === 'loading'" state="loading" />
  </section>
</template>

<style scoped>
.apps {
  margin-top: 16px;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0 0 8px;
}
h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
}
.count,
.hint,
.state {
  color: var(--text-soft);
}
.hint {
  margin: 0 0 12px;
}
.state {
  margin: 0 0 8px;
  font-weight: 700;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--tap);
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: var(--tint-mint);
  color: var(--ink);
  font: inherit;
  font-weight: 800;
}
.chip.blocked {
  background: var(--surface-muted);
}
.chip.add {
  background: var(--surface-muted);
  cursor: pointer;
}
.remove {
  min-width: var(--tap);
  min-height: var(--tap);
  margin-right: -14px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
.picker {
  margin-top: 12px;
  padding: 12px;
  border-radius: 16px;
  background: var(--bg-parent);
}
.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.choices {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--tap);
  padding: 6px 12px;
  border: 0;
  border-radius: 12px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.glyph {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface-muted);
  font-weight: 900;
}
button:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
