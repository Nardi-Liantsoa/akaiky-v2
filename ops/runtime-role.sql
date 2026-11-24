-- Rôle PostgreSQL de l'application, sans privilège d'administration.
-- À jouer UNE fois par le propriétaire de la base, après les migrations :
--   psql "$DATABASE_URL_PROPRIETAIRE" -v runtime_password="$(openssl rand -hex 24)" -f ops/runtime-role.sql
-- (le mot de passe ne s'affiche ni ne se journalise ; le noter dans app.env).
-- L'application tourne ensuite avec DB_MIGRATIONS=verify et ce rôle : elle ne
-- peut ni créer de table, ni se donner is_admin, ni effacer le journal d'audit.
-- Les migrations suivantes sont jouées par `node server/bin/migrate.js` avec
-- le compte propriétaire, et donnent elles-mêmes leurs GRANT (voir 001_init.sql).
BEGIN;
CREATE ROLE app_runtime LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT INSERT (email, name, password_hash, consent_at) ON users TO app_runtime;
GRANT UPDATE (name, password_hash, email_verified_at, failed_logins, locked_until) ON users TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON sessions, user_tokens TO app_runtime;
GRANT INSERT ON audit_log TO app_runtime;
GRANT INSERT, UPDATE ON security_quotas, login_guards, security_alerts TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON trusted_devices, mfa_factors, mfa_challenges, mfa_recovery_codes TO app_runtime;
GRANT UPDATE (used_at) ON mfa_enrollment_invites TO app_runtime;
-- Familles (003_families.sql) : création et renommage.
GRANT INSERT ON families, memberships TO app_runtime;
GRANT UPDATE (name) ON families TO app_runtime;
-- Suppression de la famille par son owner et de son propre compte (017_family_deletion.sql) :
-- la ligne de tête seule, le reste part par cascade (droits du propriétaire des tables).
GRANT DELETE ON families, users TO app_runtime;
-- Invitations et rôles (004_invitations.sql).
GRANT INSERT, DELETE ON invitations TO app_runtime;
GRANT UPDATE (used_at) ON invitations TO app_runtime;
GRANT UPDATE (role), DELETE ON memberships TO app_runtime;
-- Enfants (005_children.sql) : prénom chiffré, couleur ; jamais la famille d'un enfant.
GRANT INSERT, DELETE ON children TO app_runtime;
GRANT UPDATE (first_name_enc, avatar_color) ON children TO app_runtime;
-- Code parent (009_parent_code.sql) : hachage et date seulement ; config_version suit par déclencheur.
GRANT UPDATE (parent_code_hash, parent_code_set_at) ON children TO app_runtime;
-- Demande d'un nouveau code par l'équipe (029_parent_code_reset.sql) : date seulement, hors déclencheur.
GRANT UPDATE (parent_code_reset_requested_at) ON children TO app_runtime;
-- Déverrouillage à distance (010_unlocks.sql) : échéance seulement.
GRANT UPDATE (remote_unlock_until) ON children TO app_runtime;
-- Sirène pendant un SOS (022_sos_siren.sql) : config_version suit par déclencheur.
GRANT UPDATE (sos_siren) ON children TO app_runtime;
-- Numéro de l'enfant (025_child_phone.sql) : chiffré, jamais la famille.
GRANT UPDATE (phone_enc) ON children TO app_runtime;
-- Contacts autorisés (006_allowed_contacts.sql) : jamais la famille ni l'enfant d'un contact.
GRANT INSERT, DELETE ON allowed_contacts TO app_runtime;
GRANT UPDATE (name_enc, phone_enc, phone_index, position, avatar_color, member_user_id) ON allowed_contacts TO app_runtime;
-- Appairage (007_devices.sql) : jamais la famille ni l'enfant d'un appareil, ni l'appareil d'une session.
GRANT INSERT, DELETE ON pairing_tokens TO app_runtime;
GRANT UPDATE (used_at) ON pairing_tokens TO app_runtime;
GRANT INSERT ON child_devices TO app_runtime;
GRANT UPDATE (last_seen_at, revoked_at) ON child_devices TO app_runtime;
GRANT INSERT, DELETE ON device_sessions TO app_runtime;
GRANT UPDATE (token_hash, expires_at, last_seen_at, refresh_hash, previous_refresh_hash, discarded_refresh_hash, rotated_at, refresh_expires_at) ON device_sessions TO app_runtime;
-- Journal du téléphone (008_device_events.sql) : ajout seul.
GRANT INSERT ON device_events TO app_runtime;
-- Messages rapides (012_quick_messages.sql) : ajout seul.
GRANT INSERT ON quick_messages, quick_message_reads TO app_runtime;
-- Purge à échéance (016_retention.sql) : lancer la fonction, rien d'autre (aucun DELETE
-- sur les journaux ; les durées sont fixées dans la fonction).
GRANT EXECUTE ON FUNCTION purge_expired() TO app_runtime;
-- Plages horaires « école » (014_schedules.sql).
GRANT INSERT, DELETE ON schedules TO app_runtime;
GRANT UPDATE (label_enc, days_mask, start_min, end_min, enabled) ON schedules TO app_runtime;
-- Textes des messages rapides (013_message_templates.sql).
GRANT INSERT, DELETE ON quick_message_templates TO app_runtime;
GRANT UPDATE (text_enc, updated_at) ON quick_message_templates TO app_runtime;
-- Notifications push (019_push.sql) : jamais le propriétaire d'un jeton ni le jeton ; la file
-- ne change que d'état. Purge : par purge_expired().
GRANT INSERT, DELETE ON push_tokens TO app_runtime;
GRANT UPDATE (platform, lang, last_seen_at) ON push_tokens TO app_runtime;
GRANT INSERT ON push_outbox TO app_runtime;
GRANT UPDATE (status, attempts, next_attempt_at, last_error, sent_at) ON push_outbox TO app_runtime;
-- État du téléphone (020_device_status.sql) : relevés du téléphone, alertes ouvertes puis
-- fermées (aucun DELETE : purge par purge_expired()).
GRANT UPDATE (battery_pct, charging, network, sim_state, status_at, background_status) ON child_devices TO app_runtime;
GRANT INSERT ON device_alerts TO app_runtime;
GRANT UPDATE (closed_at) ON device_alerts TO app_runtime;
-- Jeton « signal de vie » du natif (021_heartbeat_tokens.sql) : émis (30 jours), remplacé, effacé à la révocation et au rejeu.
GRANT UPDATE (heartbeat_token_hash, heartbeat_token_expires_at) ON child_devices TO app_runtime;
-- Applications autorisées (023_allowed_apps.sql) : inventaire du téléphone et liste de l'enfant
-- remplacés en entier (suppression puis ajout) ; config_version suit par déclencheur.
GRANT INSERT, DELETE ON device_apps, allowed_apps TO app_runtime;
-- Bundles OTA (024_ota_bundles.sql) : lecture seule (SELECT ci-dessus, aussi accordé par la
-- migration). Aucun INSERT, UPDATE ni DELETE : la publication passe par server/bin/ota-publish.js
-- avec le compte propriétaire.
GRANT SELECT ON ota_bundles TO app_runtime;
-- Connexion par téléphone (027_phone_auth.sql) : numéro écrit à l'inscription seulement (aucun
-- UPDATE (phone)), date de confirmation ; codes SMS émis, essais comptés, consommés ; compteurs
-- d'envoi par numéro. Purge par purge_expired().
GRANT INSERT (phone) ON users TO app_runtime;
GRANT UPDATE (phone_verified_at) ON users TO app_runtime;
GRANT INSERT, DELETE ON phone_codes TO app_runtime;
GRANT UPDATE (code_hash, attempts, expires_at, created_at) ON phone_codes TO app_runtime;
GRANT INSERT ON phone_send_limits TO app_runtime;
GRANT UPDATE (sends, window_expires_at, last_sent_at) ON phone_send_limits TO app_runtime;
-- Désactivation d'un compte par l'équipe (028_account_disable.sql) : la date seule.
GRANT UPDATE (disabled_at) ON users TO app_runtime;
-- Position à la demande (030_positions.sql) : positions en ajout seul (purge par
-- purge_expired()) ; demandes posées puis prolongées, jamais déplacées.
GRANT INSERT ON positions, location_requests TO app_runtime;
GRANT UPDATE (created_at, watch_until) ON location_requests TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
COMMIT;
