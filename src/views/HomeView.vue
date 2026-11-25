<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppIcon from '../components/ui/AppIcon.vue'
import type { IconName } from '../components/ui/icons'
import { auth } from '../store/auth'
import { useT } from '../composables/useT'

// Accueil public (NAR-225, maquettes 03 et 04) : accroche, deux actions, aperçu du téléphone
// de l'enfant dessiné en HTML/CSS (aucune image, aucun service tiers), trois atouts.
// Bureau : texte à gauche, téléphone à droite.
const t = useT()
const FEATURE_ICONS: readonly IconName[] = ['call', 'siren', 'shield']
// Heure fixe de l'aperçu, comme sur la maquette : ce n'est pas une horloge.
const PREVIEW_TIME = '14:32'
</script>

<template>
  <main class="page landing">
    <section class="hero">
      <div class="pitch">
        <p class="badge"><AppIcon name="shield" :size="18" />{{ t.home.badge }}</p>
        <h1>{{ t.home.title }}</h1>
        <p class="lead">{{ t.home.lead }}</p>
        <div class="actions">
          <RouterLink v-if="auth.user" class="btn" :to="{ name: 'espace' }">{{ t.home.open }}</RouterLink>
          <template v-else>
            <RouterLink class="btn" :to="{ name: 'connexion', query: { mode: 'register' } }">{{ t.home.start }}</RouterLink>
            <RouterLink class="btn btn-ghost" :to="{ name: 'connexion' }">{{ t.home.login }}</RouterLink>
          </template>
        </div>
      </div>
      <!-- Aperçu : image décorative nommée en une phrase ; son contenu n'est pas lu. -->
      <div class="phone" role="img" :aria-label="t.home.phone.label">
        <div class="screen" aria-hidden="true">
          <p class="time">{{ PREVIEW_TIME }}</p>
          <div class="tiles">
            <span class="tile mom"><b>{{ t.home.phone.mom[0] }}</b>{{ t.home.phone.mom }}</span>
            <span class="tile dad"><b>{{ t.home.phone.dad[0] }}</b>{{ t.home.phone.dad }}</span>
            <span class="tile grandma"><b>{{ t.home.phone.grandma[0] }}</b>{{ t.home.phone.grandma }}</span>
            <span class="tile sos"><b>{{ 'SOS' }}</b></span>
          </div>
          <p class="locked">{{ t.home.phone.locked }}</p>
        </div>
      </div>
    </section>
    <ul class="features" :aria-label="t.home.featuresLabel">
      <li v-for="(f, i) in t.home.features" :key="f.title" class="feature">
        <span class="icon" :class="`icon-${i}`" aria-hidden="true"><AppIcon :name="FEATURE_ICONS[i]" /></span>
        <div>
          <h2>{{ f.title }}</h2>
          <p>{{ f.text }}</p>
        </div>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.landing {
  max-width: var(--wide-width);
}
.hero {
  display: grid;
  gap: var(--space-6);
  align-items: center;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 800;
}
h1 {
  font-size: clamp(2rem, 1.3rem + 3.4vw, 4rem);
  line-height: 1.08;
  margin: 0 0 var(--space-4);
}
.lead {
  max-width: 46ch;
  margin: 0 0 var(--space-5);
  color: var(--text-soft);
  font-size: 1.15rem;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.actions .btn {
  padding-inline: var(--space-6);
}
/* Téléphone de l'enfant, en CSS seul : cadre, heure, tuiles des contacts et SOS. */
.phone {
  justify-self: center;
  width: min(260px, 72vw);
  padding: var(--space-3);
  border-radius: var(--radius-device);
  background: var(--ink);
  box-shadow: var(--shadow-float);
}
.screen {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-3) var(--space-6);
  border-radius: calc(var(--radius-device) - var(--space-3));
  background: var(--bg-child);
}
.time {
  margin: 0;
  color: var(--ink);
  font-size: 2rem;
  font-weight: 900;
  text-align: center;
}
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
.tile {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  border-radius: var(--radius-sm);
  color: var(--on-color);
  font-size: 0.85rem;
  font-weight: 800;
}
.tile b {
  font-size: 2rem;
  line-height: 1;
}
.mom { background: var(--accent-orange); }
.dad { background: var(--accent-blue); }
.grandma { background: var(--accent-violet); }
.sos { background: var(--sos); }
.locked {
  margin: 0;
  padding: var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--text-soft);
  font-size: var(--fs-small);
  font-weight: 700;
  text-align: center;
}
.features {
  display: grid;
  gap: var(--space-3);
  margin: var(--space-6) 0 0;
  padding: 0;
  list-style: none;
}
.feature {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-5);
  border-radius: var(--radius);
  background: var(--surface);
}
.feature h2 {
  margin: 0 0 var(--space-1);
}
.feature p {
  margin: 0;
  color: var(--text-soft);
}
.icon {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  border-radius: var(--radius-sm);
}
.icon-0 { background: var(--tint-mint); color: var(--call); }
.icon-1 { background: color-mix(in srgb, var(--sos) 12%, transparent); color: var(--sos); }
.icon-2 { background: var(--tint-sky); color: var(--accent-blue); }

/* Bureau (maquette 04) : texte à gauche, téléphone à droite, atouts sur trois colonnes. */
@media (min-width: 900px) {
  .hero {
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  }
  .actions {
    flex-direction: row;
  }
  .features {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
