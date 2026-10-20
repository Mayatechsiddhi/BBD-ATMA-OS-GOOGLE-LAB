BEGIN;
-- Keep identity global for Better Auth. Protect every tenant-owned table.
-- The migration owner remains trusted (it can ALTER/DROP these policies anyway).
-- Runtime connections must never own tables or inherit the migration role.
CREATE SCHEMA IF NOT EXISTS bbd_private;
REVOKE ALL ON SCHEMA bbd_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION bbd_private.actor_id() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(current_setting('bbd.actor_id', true), '') $$;
CREATE OR REPLACE FUNCTION bbd_private.organization_id() RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(current_setting('bbd.organization_id', true), '') $$;

-- Fixed SQL, fixed search_path, no dynamic SQL; avoids recursive Membership RLS.
CREATE OR REPLACE FUNCTION bbd_private.membership_role(target_organization text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
 SELECT m.role::text FROM public."Membership" m
 WHERE m."organizationId" = target_organization
   AND m."userId" = bbd_private.actor_id()
$$;
CREATE OR REPLACE FUNCTION bbd_private.invitation_recipient(hash text, email text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
 SELECT hash = nullif(current_setting('bbd.invitation_hash', true), '')
 AND EXISTS (SELECT 1 FROM public."User" u WHERE u.id = bbd_private.actor_id()
             AND u."emailVerified" AND lower(u.email) = email)
$$;

DO $$
DECLARE t text; owner_name text;
BEGIN
 FOREACH t IN ARRAY ARRAY['Organization','Membership','Invitation','AuditEvent','Contact'] LOOP
  SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class
  WHERE oid = format('public.%I',t)::regclass;
  IF owner_name <> current_user THEN
   RAISE EXCEPTION 'RLS migration must run as the existing table owner';
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY migration_owner ON public.%I TO %I USING (true) WITH CHECK (true)',t,owner_name);
 END LOOP;
END $$;

CREATE POLICY organization_read ON public."Organization" FOR SELECT USING (
 (bbd_private.organization_id() IS NULL OR id = bbd_private.organization_id())
 AND bbd_private.membership_role(id) IS NOT NULL
);
CREATE POLICY organization_update ON public."Organization" FOR UPDATE USING (
 id = bbd_private.organization_id() AND bbd_private.membership_role(id) IN ('OWNER','ADMIN')
) WITH CHECK (id = bbd_private.organization_id() AND bbd_private.membership_role(id) IN ('OWNER','ADMIN'));

CREATE POLICY membership_read ON public."Membership" FOR SELECT USING (
 (bbd_private.organization_id() IS NULL AND "userId" = bbd_private.actor_id())
 OR ("organizationId" = bbd_private.organization_id()
     AND bbd_private.membership_role("organizationId") IS NOT NULL)
);
CREATE POLICY membership_insert ON public."Membership" FOR INSERT WITH CHECK (
 "organizationId" = bbd_private.organization_id() AND (
 bbd_private.membership_role("organizationId") = 'OWNER'
 OR ("userId" = bbd_private.actor_id() AND EXISTS (
  SELECT 1 FROM public."Invitation" i WHERE i."organizationId" = "Membership"."organizationId"
  AND i.role = "Membership".role AND i."acceptedAt" IS NULL AND i."expiresAt" > now()
  AND bbd_private.invitation_recipient(i."tokenHash",i.email)
 )))
);
CREATE POLICY membership_update ON public."Membership" FOR UPDATE USING (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") = 'OWNER'
) WITH CHECK ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") = 'OWNER');
CREATE POLICY membership_delete ON public."Membership" FOR DELETE USING (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") = 'OWNER'
);

ALTER TABLE public."Invitation" ADD CONSTRAINT "Invitation_non_owner_role" CHECK (role IN ('ADMIN','MEMBER'));
CREATE POLICY invitation_read ON public."Invitation" FOR SELECT USING (
 ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN'))
 OR ((bbd_private.organization_id() IS NULL OR "organizationId" = bbd_private.organization_id())
     AND "expiresAt" > now()
     AND bbd_private.invitation_recipient("tokenHash",email))
);
CREATE POLICY invitation_insert ON public."Invitation" FOR INSERT WITH CHECK (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')
);
CREATE POLICY invitation_accept ON public."Invitation" FOR UPDATE USING (
 "organizationId" = bbd_private.organization_id() AND "acceptedAt" IS NULL AND "expiresAt" > now()
 AND bbd_private.invitation_recipient("tokenHash",email)
) WITH CHECK ("organizationId" = bbd_private.organization_id() AND "acceptedAt" IS NOT NULL
 AND bbd_private.invitation_recipient("tokenHash",email));
CREATE POLICY invitation_delete ON public."Invitation" FOR DELETE USING (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')
);

CREATE POLICY audit_read ON public."AuditEvent" FOR SELECT USING (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IS NOT NULL
);
CREATE POLICY audit_append ON public."AuditEvent" FOR INSERT WITH CHECK (
 "organizationId" = bbd_private.organization_id() AND "actorId" = bbd_private.actor_id()
 AND bbd_private.membership_role("organizationId") IS NOT NULL
);
CREATE POLICY contact_read ON public."Contact" FOR SELECT USING (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IS NOT NULL
);
CREATE POLICY contact_insert ON public."Contact" FOR INSERT WITH CHECK (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')
);
CREATE POLICY contact_update ON public."Contact" FOR UPDATE USING (
 "organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN')
) WITH CHECK ("organizationId" = bbd_private.organization_id() AND bbd_private.membership_role("organizationId") IN ('OWNER','ADMIN'));

-- Narrow, atomic bootstrap; runtime has no direct Organization INSERT privilege.
CREATE OR REPLACE FUNCTION bbd_private.create_organization(new_id text, new_name text, new_slug text)
RETURNS public."Organization" LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE result public."Organization"; actor text := bbd_private.actor_id();
BEGIN
 IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public."User" WHERE id=actor AND "emailVerified") THEN
  RAISE EXCEPTION 'Verified actor required' USING ERRCODE='42501';
 END IF;
 INSERT INTO public."Organization" (id,name,slug,"createdAt","updatedAt")
 VALUES(new_id,new_name,new_slug,now(),now()) RETURNING * INTO result;
 INSERT INTO public."Membership" (id,"organizationId","userId",role,"createdAt")
 VALUES(gen_random_uuid()::text,new_id,actor,'OWNER',now());
 INSERT INTO public."AuditEvent" (id,"organizationId","actorId",action,"createdAt")
 VALUES(gen_random_uuid()::text,new_id,actor,'organization.created',now());
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bbd_private FROM PUBLIC;

COMMIT;
