-- Appels entrants du téléphone de l'enfant (NAR-145), dans le même journal que les
-- appels sortants (NAR-166) et les déverrouillages (NAR-168) :
-- * `call_in` : appel d'un contact autorisé, qui a sonné (durée lue après l'appel) ;
-- * `call_blocked` : appel d'un numéro hors liste ou masqué, rejeté sans sonnerie.
-- Numéro d'un inconnu : donnée personnelle d'un tiers, chiffré au repos (phone_enc) ;
-- index aveugle (HMAC) pour compter les appels d'un même numéro sans le déchiffrer.
ALTER TABLE device_events DROP CONSTRAINT device_events_kind_check;
ALTER TABLE device_events
  ADD CONSTRAINT device_events_kind_check CHECK (kind IN ('call_out', 'call_in', 'call_blocked', 'unlock')),
  ADD COLUMN phone_index bytea,
  -- Un appel bloqué n'a ni contact ni nom, et pas de durée (il n'a pas sonné).
  ADD CONSTRAINT device_events_blocked_shape CHECK (
    kind <> 'call_blocked' OR (contact_id IS NULL AND name_enc IS NULL AND duration_s IS NULL)
  );
CREATE INDEX device_events_child_kind ON device_events(child_id, kind, started_at DESC);
