BEGIN;
-- A session-level value accidentally left in a pool cannot authorize a later tx.
CREATE OR REPLACE FUNCTION bbd_private.actor_id() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE WHEN nullif(current_setting('bbd.context_transaction',true),'') IS NOT NULL
  AND current_setting('bbd.context_transaction',true) = pg_current_xact_id()::text
 THEN nullif(current_setting('bbd.actor_id',true),'') END
$$;
CREATE OR REPLACE FUNCTION bbd_private.organization_id() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT CASE WHEN bbd_private.actor_id() IS NOT NULL
 THEN nullif(current_setting('bbd.organization_id',true),'') END
$$;
CREATE OR REPLACE FUNCTION bbd_private.invitation_recipient(hash text, email text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT $1 = nullif(current_setting('bbd.invitation_hash',true),'')
 AND EXISTS (SELECT 1 FROM public."User" u WHERE u.id = bbd_private.actor_id()
             AND u."emailVerified" AND lower(u.email) = $2)
$$;
-- INSERT ... RETURNING must see the recipient's own newly inserted membership.
-- It must not depend on seeing that row through a STABLE helper's older snapshot.
CREATE POLICY membership_self ON public."Membership" FOR SELECT USING (
 "userId" = bbd_private.actor_id() AND
 (bbd_private.organization_id() IS NULL OR "organizationId" = bbd_private.organization_id())
);
COMMIT;
