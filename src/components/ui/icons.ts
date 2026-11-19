// Jeu d'icônes unique de l'application (NAR-182), tracés en ligne sans bibliothèque.
// Chaque icône : ses formes SVG et, au besoin, son cadre et ses attributs propres.

export interface IconShape {
  tag: 'path' | 'circle' | 'rect'
  attrs: Record<string, string | number>
}

export interface IconDef {
  viewBox?: string
  // Attributs posés sur <svg> en plus (ou à la place) des valeurs par défaut.
  svg?: Record<string, string | number>
  shapes: IconShape[]
}

const path = (d: string): IconShape => ({ tag: 'path', attrs: { d } })
const circle = (cx: number, cy: number, r: number): IconShape => ({ tag: 'circle', attrs: { cx, cy, r } })
const rect = (attrs: Record<string, string | number>): IconShape => ({ tag: 'rect', attrs })

export const ICONS = {
  // Barre d'onglets parent.
  home: { shapes: [path('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z')] },
  list: { shapes: [path('M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01')] },
  sliders: { shapes: [path('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6')] },
  users: { shapes: [path('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')] },
  // Messages rapides (maquette écran 4) : maison, voiture, horloge, sourire.
  'quick-home': { shapes: [path('M3 11l9-7 9 7'), path('M5 10v10h14V10'), path('M10 20v-6h4v6')] },
  car: { shapes: [path('M5 16l1.5-6h11L19 16'), rect({ x: 3, y: 16, width: 18, height: 4, rx: 1 }), circle(7.5, 20, 1.5), circle(16.5, 20, 1.5)] },
  clock: { shapes: [circle(12, 12, 9), path('M12 7v5l3 2')] },
  smile: { shapes: [circle(12, 12, 9), path('M8 14a5 5 0 0 0 8 0'), path('M9 9.5h.01M15 9.5h.01')] },
  // Pastille d'appel des contacts de l'enfant (pleine).
  call: {
    svg: { fill: 'currentColor', stroke: 'none' },
    shapes: [path('M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z')]
  },
  // Journal.
  phone: { shapes: [path('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2')] },
  blocked: { shapes: [circle(12, 12, 9), path('M6 6l12 12')] },
  unlock: { shapes: [rect({ x: 5, y: 11, width: 14, height: 10, rx: 2 }), path('M8 11V7a4 4 0 0 1 7.5-2')] },
  // Accueil enfant.
  mail: { shapes: [rect({ x: 3, y: 5, width: 18, height: 14, rx: 2 }), path('M3 7l9 6 9-6')] },
  // Lien vers un écran (« Mon compte »).
  'chevron-right': { shapes: [path('M9 6l6 6-6 6')] },
  // Batterie : contour et borne ; le niveau, variable, est passé dans l'emplacement.
  battery: {
    viewBox: '0 0 24 12',
    svg: { 'stroke-width': 1 },
    shapes: [
      rect({ x: 0.5, y: 0.5, width: 20, height: 11, rx: 2.5 }),
      rect({ x: 21, y: 3.5, width: 2.5, height: 5, rx: 1, fill: 'currentColor', stroke: 'none' })
    ]
  }
} satisfies Record<string, IconDef>

export type IconName = keyof typeof ICONS
