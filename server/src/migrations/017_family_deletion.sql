-- Suppression de la famille par son parent principal et suppression de son propre compte
-- (NAR-177, critère C21). Aucune clé étrangère à changer : tout ce qui dépend d'une famille
-- part par cascade (memberships, invitations, children ; depuis l'enfant : allowed_contacts,
-- pairing_tokens, child_devices puis device_sessions, device_events, quick_messages puis
-- quick_message_reads, quick_message_templates, schedules), et tout ce qui dépend d'un compte
-- aussi (sessions, user_tokens, trusted_devices, MFA, memberships, quick_message_reads ;
-- invitations.invited_by, pairing_tokens.created_by et le membre lié d'un contact passent à
-- NULL). Les actions de clé étrangère s'exécutent avec les droits du propriétaire des tables :
-- le rôle applicatif ne reçoit que le DELETE de la ligne de tête, rien sur les journaux.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT DELETE ON families TO app_runtime;
    GRANT DELETE ON users TO app_runtime;
  END IF;
END $$;
