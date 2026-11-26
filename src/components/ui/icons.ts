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
  // Position (NAR-204) : épingle de carte.
  pin: { shapes: [path('M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z'), circle(12, 9.5, 2.5)] },
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
  // Retour vers l'écran parent (sections de Réglages, NAR-185).
  'chevron-left': { shapes: [path('M15 6l-6 6 6 6')] },
  // Information (indication du journal, NAR-235).
  info: { shapes: [circle(12, 12, 9), path('M12 11v5M12 8h.01')] },
  // Pastilles et barre de l'accueil enfant (maquette allégée, NAR-238) : alerte, école, réglages.
  'alert-circle': { shapes: [circle(12, 12, 9), path('M12 7.5v5.5M12 16.5h.01')] },
  cap: { shapes: [path('M2 9l10-5 10 5-10 5z'), path('M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5')] },
  gear: { shapes: [circle(12, 12, 3), path('M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1')] },
  // Effacer un chiffre du code parent (NAR-240).
  backspace: { shapes: [path('M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z'), path('M12 9l5 6M17 9l-5 6')] },
  // Cadenas fermé : code parent de l'accueil enfant (NAR-237).
  lock: { shapes: [rect({ x: 4, y: 11, width: 16, height: 10, rx: 2 }), path('M8 11V7a4 4 0 0 1 8 0v4')] },
  // Ordre des contacts (maquette 05, NAR-232).
  'chevron-up': { shapes: [path('M6 15l6-6 6 6')] },
  'chevron-down': { shapes: [path('M6 9l6 6 6-6')] },
  // Sélecteur de jour du journal (NAR-233).
  calendar: { shapes: [rect({ x: 4, y: 5, width: 16, height: 15, rx: 2 }), path('M4 10h16M8 3v4M16 3v4')] },
  // Lignes du résumé de Réglages (NAR-185) : applications (grille), SOS (sirène).
  grid: { shapes: [rect({ x: 4, y: 4, width: 6, height: 6, rx: 1.5 }), rect({ x: 14, y: 4, width: 6, height: 6, rx: 1.5 }), rect({ x: 4, y: 14, width: 6, height: 6, rx: 1.5 }), rect({ x: 14, y: 14, width: 6, height: 6, rx: 1.5 })] },
  // Page d'accueil publique (NAR-225) : choix de la langue, applications bloquées.
  // Page Mon compte (NAR-228) : notifications, sortie, nouveaux codes, suppression, appareils.
  bell: { shapes: [path('M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z'), path('M10 20a2 2 0 0 0 4 0')] },
  logout: { shapes: [path('M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4'), path('M10 16l-4-4 4-4M6 12h10')] },
  refresh: { shapes: [path('M20 11a8 8 0 0 0-14.5-4.5L4 8'), path('M4 4v4h4'), path('M4 13a8 8 0 0 0 14.5 4.5L20 16'), path('M20 20v-4h-4')] },
  trash: { shapes: [path('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')] },
  monitor: { shapes: [rect({ x: 3, y: 4, width: 18, height: 12, rx: 2 }), path('M8 20h8M12 16v4')] },
  smartphone: { shapes: [rect({ x: 7, y: 2, width: 10, height: 20, rx: 2 }), path('M11 18h2')] },
  // Page Famille (NAR-228) : renommer, données exportées, compte de la personne.
  edit: { shapes: [path('M4 20h4L19 9l-4-4L4 16z'), path('M13.5 6.5l4 4')] },
  download: { shapes: [path('M12 4v11M7 10l5 5 5-5M5 20h14')] },
  user: { shapes: [circle(12, 8, 4), path('M4 21a8 8 0 0 1 16 0')] },
  plus: { shapes: [path('M12 5v14M5 12h14')] },
  // Réseau (pastille de l'état du téléphone, maquette 01, NAR-227).
  signal: { shapes: [path('M5 19v-2M9 19v-5M13 19v-8M17 19V8M21 19V5')] },
  // Code QR (« Relier le téléphone », maquette 01, NAR-227).
  qr: { shapes: [rect({ x: 4, y: 4, width: 6, height: 6, rx: 1 }), rect({ x: 14, y: 4, width: 6, height: 6, rx: 1 }), rect({ x: 4, y: 14, width: 6, height: 6, rx: 1 }), path('M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2z')] },
  globe: { shapes: [circle(12, 12, 9), path('M3 12h18'), path('M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18')] },
  // Flèche de navigation (« J'arrive », alerte SOS, NAR-249).
  navigate: { shapes: [path('M3 11 22 2l-9 19-2-8-8-2z')] },
  shield: { shapes: [path('M12 3l7 3v5c0 4.5-3 8.5-7 10c-4-1.5-7-5.5-7-10V6z')] },
  siren: { shapes: [path('M7 18v-6a5 5 0 0 1 10 0v6'), path('M5 21h14v-3H5z'), path('M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4')] },
  // État du téléphone sur l'accueil parent (NAR-192) : pastille, bandeaux, tuiles en défaut.
  check: { shapes: [path('M5 12.5l4.5 4.5L19 7')] },
  warning: { shapes: [path('M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'), path('M12 9v4M12 17h.01')] },
  cross: { shapes: [path('M6 6l12 12M18 6 6 18')] },
  sim: { shapes: [path('M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z'), rect({ x: 9, y: 11, width: 6, height: 6, rx: 1 })] },
  // Menu « ⋯ » de la carte d'un enfant : trois points pleins.
  more: { svg: { fill: 'currentColor', stroke: 'none' }, shapes: [circle(5, 12, 2), circle(12, 12, 2), circle(19, 12, 2)] },
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
