import { ref } from 'vue'

// Résumé de Réglages tenu à jour sur ordinateur (NAR-223) : la liste des sections reste
// montée à côté de la section ouverte, donc n'est plus relue en y revenant. Une carte qui
// enregistre (applications, plages, messages rapides) le signale ; le résumé relit alors ses
// sources, sans effacer ce qu'il affiche.
export const summaryVersion = ref(0)
export const summaryChanged = () => { summaryVersion.value++ }
