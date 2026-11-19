// Plage « école » vue par le minuteur de l'écran (NAR-143). À chaque début et fin de plage,
// l'état du verrou est réappliqué (`refresh` : liste du lock task sans, puis avec, les
// applications autorisées). Tant que la plage dure et que l'app n'est pas devant, l'app est
// redemandée au premier plan à chaque tour (`bring`), jusqu'à ce que le natif réponde
// `brought: true` ; de nouveau si l'app quitte ensuite le premier plan pendant la plage.
export interface SchoolTick { school: boolean, foreground: boolean, active: boolean }
export interface SchoolFrontDeps {
  bring: () => Promise<{ brought: boolean }>
  refresh: () => Promise<unknown>
}

export function createSchoolFront({ bring, refresh }: SchoolFrontDeps) {
  let wasSchool = false
  let brought = false
  // Un seul appel natif en cours : un tour lent n'en empile pas un second.
  let pending = false
  return function tick({ school, foreground, active }: SchoolTick): void {
    const edge = school !== wasSchool
    wasSchool = school
    // App devant, ou plage terminée : la prochaine sortie du premier plan sera redemandée.
    if (foreground || !school) brought = false
    if (!active) return
    if (edge) void refresh().catch(() => {})
    if (!school || foreground || brought || pending) return
    pending = true
    void bring()
      .then((r) => { if (r?.brought === true && wasSchool) brought = true })
      .catch(() => {})
      .finally(() => { pending = false })
  }
}
