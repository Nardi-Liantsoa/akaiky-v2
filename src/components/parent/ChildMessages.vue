<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { listMessages, markRead, type QuickMessage } from '../../api/messages'
import { locale, useT } from '../../composables/useT'
import { formatClock, formatDay } from '../../lib/format'
import { QUICK_TINT } from '../../lib/quickMessages'
import QuickIcon from '../messages/QuickIcon.vue'

// Messages rapides de l'enfant sur l'accueil parent (NAR-150, C14). Affichés = vus :
// chaque message pas encore vu par ce parent est marqué comme vu, et l'enfant voit
// « <nom> l'a vu ». Relus toutes les 30 s tant que l'accueil est ouvert (le push viendra
// avec NAR-141).
const props = defineProps<{ childId: string, childName: string }>()
const t = useT()
const items = ref<QuickMessage[]>([])
const status = ref<'loading' | 'ready' | 'error'>('loading')
let generation = 0

async function load() {
  const mine = ++generation
  const childId = props.childId
  try {
    const list = await listMessages(childId, 5)
    if (mine !== generation) return
    items.value = list
    status.value = 'ready'
    const unseen = list.filter((x) => !x.readByMe)
    if (!unseen.length) return
    const marked = await Promise.all(unseen.map((m) => markRead(m.id).then(() => true, () => false)))
    // Relu aussitôt (si au moins un « vu » est passé) : « Vu par » inclut ce parent.
    if (marked.some(Boolean) && mine === generation) items.value = await listMessages(childId, 5).catch(() => items.value)
  } catch {
    if (mine === generation && status.value !== 'ready') status.value = 'error'
  }
}
watch(() => props.childId, () => { status.value = 'loading'; items.value = []; void load() }, { immediate: true })
const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
onBeforeUnmount(() => { clearInterval(timer); generation++ })

const when = (iso: string) => `${formatDay(iso, locale.value)} · ${formatClock(new Date(iso))}`
</script>

<template>
  <section class="card messages">
    <h2>{{ t.parent.home.messages(childName) }}</h2>
    <p v-if="status === 'error'" class="error" role="alert">{{ t.parent.home.messagesError }}</p>
    <ul v-else-if="items.length" class="list">
      <li v-for="m in items" :key="m.id">
        <span class="icon" :style="{ background: QUICK_TINT[m.slot] }"><QuickIcon :kind="m.slot" :size="28" /></span>
        <span class="body">
          <span class="text">{{ t.child.quick.texts[m.slot - 1] }}</span>
          <span class="meta">{{ when(m.sentAt) }}</span>
          <span v-if="m.readBy.length" class="meta">{{ t.parent.home.seenBy(m.readBy.map((r) => r.name).join(', ')) }}</span>
        </span>
      </li>
    </ul>
    <p v-else-if="status === 'ready'" class="empty">{{ t.parent.home.noMessages }}</p>
  </section>
</template>

<style scoped>
.messages {
  margin-top: 16px;
}
h2 {
  margin: 0 0 8px;
  font-size: 1.15rem;
  font-weight: 800;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  color: var(--text);
}
.body {
  display: flex;
  flex-direction: column;
}
.text {
  font-weight: 800;
}
.meta,
.empty {
  color: var(--text-soft);
  font-size: 0.92rem;
  font-weight: 600;
}
.empty {
  margin: 0;
}
</style>
