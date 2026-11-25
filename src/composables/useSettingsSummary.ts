import { reactive, watch } from 'vue'
import { getApps, type ChildApps } from '../api/apps'
import { getTemplates, type MessageTemplate } from '../api/messages'
import { getSchedules, type Schedule } from '../api/schedules'

// Données du résumé de Réglages (NAR-185) : les trois lectures par enfant que les cartes
// font déjà (applications, plages, messages rapides), lancées ensemble, une fois par
// arrivée et par enfant. Contacts, code parent et SOS viennent des stores déjà chargés.
// État local au résumé : relu à chaque retour d'une section, donc à jour.
export type Loaded<T> = { status: 'loading', data: null } | { status: 'ready', data: T } | { status: 'error', data: null }

export function useSettingsSummary(childId: () => string) {
  const state = reactive({
    apps: { status: 'loading', data: null } as Loaded<ChildApps>,
    schedules: { status: 'loading', data: null } as Loaded<Schedule[]>,
    templates: { status: 'loading', data: null } as Loaded<MessageTemplate[]>
  })
  const sources = { apps: getApps, schedules: getSchedules, templates: getTemplates } as const
  type Key = keyof typeof sources
  // Seule la réponse de la dernière lecture d'une source est appliquée (changement d'enfant).
  const generation: Record<Key, number> = { apps: 0, schedules: 0, templates: 0 }

  // quiet : relecture après un enregistrement (NAR-223), ce qui est affiché reste en place.
  function load<K extends Key>(key: K, id: string, quiet = false) {
    const mine = ++generation[key]
    if (!quiet || state[key].status !== 'ready') state[key] = { status: 'loading', data: null }
    ;(sources[key](id) as Promise<unknown>).then(
      (data) => { if (mine === generation[key]) state[key] = { status: 'ready', data } as (typeof state)[K] },
      () => { if (mine === generation[key]) state[key] = { status: 'error', data: null } }
    )
  }
  const keys = Object.keys(sources) as Key[]
  watch(childId, (id) => { for (const k of keys) load(k, id) }, { immediate: true })

  // « Réessayer » : seules les lectures en échec repartent.
  function retry() {
    for (const k of keys) if (state[k].status === 'error') load(k, childId())
  }
  // Une carte a enregistré : toutes les sources relues sans effacement.
  function refresh() {
    for (const k of keys) load(k, childId(), true)
  }
  return { state, retry, refresh }
}
