-- Fenêtre des secours (NAR-196) : après un appel de l'enfant aux secours, le téléphone laisse
-- sonner tout appel entrant pendant 30 min (leur rappel vient souvent d'un numéro inconnu ou
-- masqué). Un tel appel, qui aurait été refusé, est noté `call_in` marqué `emergency_window` ;
-- son numéro est tel que reçu, absent s'il était masqué. Marque réservée aux appels reçus.
-- Additive (défaut faux) : la version précédente de l'API et de l'app tourne sans changement.
ALTER TABLE device_events
  ADD COLUMN emergency_window boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT device_events_emergency_window_kind CHECK (NOT emergency_window OR kind = 'call_in');
