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
GRANT INSERT, UPDATE, DELETE ON sessions, user_tokens, notes TO app_runtime;
GRANT INSERT ON audit_log TO app_runtime;
GRANT INSERT, UPDATE ON security_quotas, login_guards, security_alerts TO app_runtime;
GRANT INSERT, UPDATE, DELETE ON trusted_devices, mfa_factors, mfa_challenges, mfa_recovery_codes TO app_runtime;
GRANT UPDATE (used_at) ON mfa_enrollment_invites TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;
COMMIT;
