-- Appel d'un contact connu refusé pendant une plage « école » (NAR-176) : l'appel bloqué
-- peut désormais porter le contact et son nom (instantané), toujours avec son numéro, et
-- jamais de durée (il n'a pas sonné). Contrainte relâchée seulement : la version
-- précédente de l'app tourne sans changement sur ce schéma. Vérification des lignes
-- existantes sous verrou, dans la transaction de la migration (journal encore petit).
ALTER TABLE device_events DROP CONSTRAINT IF EXISTS device_events_blocked_shape;
ALTER TABLE device_events ADD CONSTRAINT device_events_blocked_shape CHECK (
  kind <> 'call_blocked' OR (duration_s IS NULL AND ((contact_id IS NULL AND name_enc IS NULL) OR phone_enc IS NOT NULL))
);
