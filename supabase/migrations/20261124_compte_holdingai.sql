-- Le Commis : connexion avec le compte HoldingAI (compte.holdingai.app).
-- Les comptes vivent maintenant dans le projet « HoldingAI Compte »; la base du Commis reconnaît leurs jetons
-- (Authentication > Third-Party Auth > Custom OIDC, émetteur https://wwakxuzuhmdmweluafiz.supabase.co/auth/v1).
-- Un membre reste reconnu par son cellulaire (private.mon_foyer). auth.uid() devient l'identifiant HoldingAI :
-- les anciennes lignes liées à l'ancien compte du Commis (propriétaire du foyer, témoignages, partages, idées,
-- sondages, abonnements aux rappels) sont reprises par reprendre_compte() à la première connexion HoldingAI.
-- La console HoldingAI garde la connexion propre au Commis (console_admins reste lié à auth.users).

alter table public.foyers drop constraint if exists foyers_proprio_fkey;
alter table public.temoignages drop constraint if exists temoignages_user_id_fkey;

create or replace function public.reprendre_compte() returns int
language plpgsql security definer set search_path = public, private as $$
declare
  moi uuid := auth.uid();
  tel text := nullif(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g'), '');
  anciens uuid[];
  n int := 0; k int;
begin
  -- seulement pour un jeton HoldingAI (l'usager n'existe pas dans auth.users de ce projet)
  if moi is null or tel is null or exists (select 1 from auth.users where id = moi) then return 0; end if;
  -- anciens comptes du Commis de la même personne : même cellulaire, ou courriel inscrit sur sa fiche de membre
  select array_agg(distinct u.id) into anciens from auth.users u
  where regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = tel
     or (u.email is not null and exists (
           select 1 from membres m
           where regexp_replace(coalesce(m.telephone, ''), '\D', '', 'g') = tel
             and lower(m.email) = lower(u.email)));
  if anciens is null then return 0; end if;
  update foyers set proprio = moi where proprio = any(anciens); get diagnostics k = row_count; n := n + k;
  update temoignages set user_id = moi where user_id = any(anciens); get diagnostics k = row_count; n := n + k;
  update partages set user_id = moi where user_id = any(anciens); get diagnostics k = row_count; n := n + k;
  update idees set user_id = moi where user_id = any(anciens); get diagnostics k = row_count; n := n + k;
  update sondages set user_id = moi where user_id = any(anciens); get diagnostics k = row_count; n := n + k;
  update abonnements set user_id = moi where user_id = any(anciens); get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function public.reprendre_compte() from public, anon;
grant execute on function public.reprendre_compte() to authenticated;
