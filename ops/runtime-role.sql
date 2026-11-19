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
GRANT INSERT (email, name, password_hash) ON users TO app_runtime;
GRANT UPDATE (name, password_hash, email_verified_at, failed_logins, locked_until) ON users TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON sessions, user_tokens TO app_runtime;
GRANT INSERT ON audit_log TO app_runtime;
GRANT INSERT, UPDATE ON security_quotas, login_guards, security_alerts TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON trusted_devices, mfa_factors, mfa_challenges, mfa_recovery_codes TO app_runtime;
GRANT UPDATE (used_at) ON mfa_enrollment_invites TO app_runtime;
-- Familles (003_families.sql) : création et renommage ; jamais de suppression de famille par l'application.
GRANT INSERT ON families, memberships TO app_runtime;
GRANT UPDATE (name) ON families TO app_runtime;
-- Invitations et rôles (004_invitations.sql).
GRANT INSERT, DELETE ON invitations TO app_runtime;
GRANT UPDATE (used_at) ON invitations TO app_runtime;
GRANT UPDATE (role), DELETE ON memberships TO app_runtime;
-- Enfants (005_children.sql) : prénom chiffré, couleur ; jamais la famille d'un enfant.
GRANT INSERT, DELETE ON children TO app_runtime;
GRANT UPDATE (first_name_enc, avatar_color) ON children TO app_runtime;
-- Code parent (009_parent_code.sql) : hachage et date seulement ; config_version suit par déclencheur.
GRANT UPDATE (parent_code_hash, parent_code_set_at) ON children TO app_runtime;
-- Déverrouillage à distance (010_unlocks.sql) : échéance seulement.
GRANT UPDATE (remote_unlock_until) ON children TO app_runtime;
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
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
COMMIT;
