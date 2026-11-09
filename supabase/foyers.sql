-- Notre épicerie : plusieurs foyers (chaque acheteur a le sien), lieux et réserves par lieu.
-- Chaque foyer a un propriétaire, un essai de 30 jours, puis un forfait payé jusqu'à une date.

-- =========================================================
-- 1. Foyers
-- =========================================================
create table if not exists public.foyers (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null default 'Mon foyer',
  proprio     uuid references auth.users(id) on delete set null,
  essai_fin   timestamptz not null default now() + interval '30 days',
  paye_jusqua timestamptz,
  circulaires boolean not null default false, -- agent des circulaires activé pour ce foyer
  cree        timestamptz not null default now()
);

-- Foyer fondateur : les données actuelles, actif à vie
insert into public.foyers (nom, proprio, paye_jusqua, circulaires)
select 'Notre foyer', (select id from auth.users order by created_at limit 1), '2099-12-31', true
where not exists (select 1 from public.foyers);

-- =========================================================
-- 2. Lieux et réserves par lieu
-- =========================================================
create table if not exists public.lieux (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null,
  ordre int  not null default 0,
  cree  timestamptz not null default now()
);
create table if not exists public.inventaire (
  id         uuid primary key default gen_random_uuid(),
  produit_id uuid not null references public.produits(id) on delete cascade,
  lieu_id    uuid not null references public.lieux(id) on delete cascade,
  espace_id  uuid references public.espaces(id) on delete set null,
  stock      numeric not null default 0,
  minimum    numeric,
  peremption date,
  maj        timestamptz not null default now(),
  unique (produit_id, lieu_id)
);
create index if not exists inventaire_lieu_idx on public.inventaire(lieu_id);
alter table public.espaces add column if not exists lieu_id uuid references public.lieux(id) on delete cascade;

-- =========================================================
-- 3. foyer_id partout, rempli avec le foyer fondateur
-- =========================================================
do $$
declare t text; f uuid := (select id from public.foyers order by cree limit 1);
begin
  foreach t in array array['membres','epicerie','surveiller','produits','speciaux','config','espaces','panier','listes','lieux','inventaire','abonnements'] loop
    execute format('alter table public.%I add column if not exists foyer_id uuid references public.foyers(id) on delete cascade', t);
    execute format('update public.%I set foyer_id = %L where foyer_id is null', t, f);
    execute format('create index if not exists %I on public.%I(foyer_id)', t || '_foyer_idx', t);
  end loop;
end $$;

-- Lieu « Maison » du foyer fondateur, ses espaces et ses réserves actuelles
insert into public.lieux (nom, ordre, foyer_id)
select 'Maison', 1, f.id from public.foyers f
where not exists (select 1 from public.lieux l where l.foyer_id = f.id);
update public.espaces e set lieu_id = (select l.id from public.lieux l where l.foyer_id = e.foyer_id order by l.ordre, l.cree limit 1) where e.lieu_id is null;
insert into public.inventaire (produit_id, lieu_id, espace_id, stock, minimum, peremption, foyer_id)
select p.id, (select l.id from public.lieux l where l.foyer_id = p.foyer_id order by l.ordre, l.cree limit 1),
       p.espace_id, coalesce(p.stock, 0), p.minimum, p.peremption, p.foyer_id
from public.produits p
where (coalesce(p.stock, 0) > 0 or p.espace_id is not null or p.minimum is not null or p.peremption is not null)
on conflict (produit_id, lieu_id) do nothing;

-- =========================================================
-- 4. Qui suis-je ? Mon foyer, actif ?
-- =========================================================
create or replace function private.mon_foyer()
returns uuid language sql stable security definer set search_path = public as $$
  select m.foyer_id from public.membres m
  where (m.email is not null and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
     or (m.telephone is not null and coalesce(auth.jwt() ->> 'phone', '') <> ''
         and regexp_replace(m.telephone, '\D', '', 'g') = regexp_replace(auth.jwt() ->> 'phone', '\D', '', 'g'))
  limit 1;
$$;
create or replace function private.est_membre()
returns boolean language sql stable security definer set search_path = public as $$
  select private.mon_foyer() is not null;
$$;
create or replace function private.foyer_actif()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.foyers f where f.id = private.mon_foyer()
                 and (f.essai_fin > now() or coalesce(f.paye_jusqua, '-infinity') > now()));
$$;
grant execute on function private.mon_foyer(), private.foyer_actif() to authenticated;

-- Le foyer est rempli tout seul à l'ajout
do $$
declare t text;
begin
  foreach t in array array['membres','epicerie','surveiller','produits','speciaux','config','espaces','panier','listes','lieux','inventaire','abonnements'] loop
    execute format('alter table public.%I alter column foyer_id set default private.mon_foyer()', t);
  end loop;
end $$;

-- =========================================================
-- 5. Contraintes par foyer
-- =========================================================
drop index if exists public.produits_nom_unique;
create unique index if not exists produits_foyer_nom_unique on public.produits (foyer_id, lower(nom));

-- config : une ligne par foyer
alter table public.config drop constraint if exists config_id_check;
alter table public.config drop constraint if exists config_pkey;
alter table public.config alter column id drop default;
alter table public.config alter column id drop not null;
create unique index if not exists config_foyer_unique on public.config (foyer_id);

-- Membres : maximum 4 par foyer, au moins 1
create or replace function private.verifier_membres()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
    new.nom := trim(coalesce(new.nom, ''));
    new.telephone := private.tel_e164(new.telephone);
    if new.telephone = 'invalide' then raise exception 'cellulaire_invalide' using errcode = 'P0001'; end if;
    if new.email is not null and new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'courriel_invalide' using errcode = 'P0001'; end if;
    if new.email is null and new.telephone is null then raise exception 'contact_requis' using errcode = 'P0001'; end if;
    if tg_op = 'INSERT' then
      if new.foyer_id is null then raise exception 'foyer_requis' using errcode = 'P0001'; end if;
      if (select count(*) from public.membres where foyer_id = new.foyer_id) >= 4 then raise exception 'limite_membres' using errcode = 'P0001'; end if;
      if new.invite_par is null then new.invite_par := coalesce(auth.jwt() ->> 'email', auth.jwt() ->> 'phone'); end if;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if (select count(*) from public.membres where foyer_id = old.foyer_id) <= 1 then raise exception 'dernier_membre' using errcode = 'P0001'; end if;
    return old;
  end if;
  return new;
end $$;
revoke all on function private.verifier_membres() from public, anon, authenticated;

-- =========================================================
-- 6. Sécurité : chacun ne voit que son foyer; on n'écrit que si le foyer est actif
-- =========================================================
do $$
declare t text;
begin
  foreach t in array array['epicerie','surveiller','produits','speciaux','config','espaces','panier','listes','lieux','inventaire'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists membres_tout on public.%I', t);
    execute format('drop policy if exists foyer_lecture on public.%I', t);
    execute format('drop policy if exists foyer_ecriture on public.%I', t);
    execute format('create policy foyer_lecture on public.%I for select to authenticated using (foyer_id = private.mon_foyer())', t);
    execute format('create policy foyer_ecriture on public.%I for all to authenticated using (foyer_id = private.mon_foyer() and private.foyer_actif()) with check (foyer_id = private.mon_foyer() and private.foyer_actif())', t);
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

drop policy if exists membres_lecture on public.membres;
drop policy if exists membres_ajout on public.membres;
drop policy if exists membres_retrait on public.membres;
drop policy if exists membres_modif on public.membres;
create policy membres_lecture on public.membres for select to authenticated using (foyer_id = private.mon_foyer());
create policy membres_ajout on public.membres for insert to authenticated with check (foyer_id = private.mon_foyer() and private.foyer_actif());
create policy membres_retrait on public.membres for delete to authenticated using (foyer_id = private.mon_foyer());
create policy membres_modif on public.membres for update to authenticated using (foyer_id = private.mon_foyer()) with check (foyer_id = private.mon_foyer());

drop policy if exists abonnements_siens on public.abonnements;
create policy abonnements_siens on public.abonnements for all to authenticated
  using (foyer_id = private.mon_foyer() and user_id = auth.uid())
  with check (foyer_id = private.mon_foyer() and user_id = auth.uid());

-- Foyers : on voit le sien; seul le propriétaire peut le renommer; personne ne change son forfait depuis l'app
alter table public.foyers enable row level security;
drop policy if exists foyer_voir on public.foyers;
drop policy if exists foyer_renommer on public.foyers;
create policy foyer_voir on public.foyers for select to authenticated using (id = private.mon_foyer());
create policy foyer_renommer on public.foyers for update to authenticated using (id = private.mon_foyer() and proprio = auth.uid()) with check (id = private.mon_foyer() and proprio = auth.uid());
revoke insert, update, delete on public.foyers from anon, authenticated;
grant select on public.foyers to authenticated;
grant update (nom) on public.foyers to authenticated;
do $$ begin alter publication supabase_realtime add table public.foyers; exception when duplicate_object then null; end $$;

-- =========================================================
-- 7. Créer son foyer (essai de 30 jours), après la vérification du cellulaire
-- =========================================================
create or replace function public.creer_foyer(p_nom text, p_prenom text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare f uuid; l uuid; tel text := nullif(auth.jwt() ->> 'phone', ''); mail text := nullif(auth.jwt() ->> 'email', '');
begin
  if auth.uid() is null then raise exception 'connexion_requise' using errcode = 'P0001'; end if;
  if private.mon_foyer() is not null then raise exception 'deja_membre' using errcode = 'P0001'; end if;
  insert into public.foyers (nom, proprio) values (coalesce(nullif(trim(p_nom), ''), 'Mon foyer'), auth.uid()) returning id into f;
  insert into public.membres (foyer_id, nom, email, telephone, invite_par)
    values (f, trim(coalesce(p_prenom, '')), mail, case when tel is null then null else '+' || regexp_replace(tel, '\D', '', 'g') end, 'creation');
  insert into public.config (foyer_id) values (f);
  insert into public.lieux (foyer_id, nom, ordre) values (f, 'Maison', 1) returning id into l;
  insert into public.espaces (foyer_id, lieu_id, nom, ordre)
    select f, l, n, o from (values ('Garde-manger',1),('Réfrigérateur',2),('Congélateur',3),('Sous-sol',4)) v(n, o);
  insert into public.listes (foyer_id, nom, ordre) values (f, 'Épicerie', 1);
  return f;
end $$;
revoke all on function public.creer_foyer(text, text) from public, anon;
grant execute on function public.creer_foyer(text, text) to authenticated;

-- Activation après paiement (appelée par la fonction Stripe, avec la clé serveur seulement)
create or replace function public.activer_foyer(p_foyer uuid, p_annees int default 1)
returns timestamptz language sql security definer set search_path = public as $$
  update public.foyers
     set paye_jusqua = greatest(now(), coalesce(paye_jusqua, now()), essai_fin) + make_interval(years => greatest(1, p_annees))
   where id = p_foyer
  returning paye_jusqua;
$$;
revoke all on function public.activer_foyer(uuid, int) from public, anon, authenticated;

-- =========================================================
-- 8. Rôle dans le foyer, état du foyer pour l'app et les agents
-- =========================================================
alter table public.membres add column if not exists role text not null default 'membre';
update public.membres m set role = 'proprio'
  from public.foyers f, auth.users u
  where m.foyer_id = f.id and u.id = f.proprio and m.role <> 'proprio'
    and ((m.email is not null and lower(m.email) = lower(u.email)) or (m.telephone is not null and regexp_replace(m.telephone, '\D', '', 'g') = regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')));

create or replace function public.mon_foyer_actif()
returns boolean language sql stable security definer set search_path = public, private as $$ select private.foyer_actif(); $$;
revoke all on function public.mon_foyer_actif() from public, anon;
grant execute on function public.mon_foyer_actif() to authenticated;

-- creer_foyer : le créateur est le propriétaire
create or replace function public.creer_foyer(p_nom text, p_prenom text)
returns uuid language plpgsql security definer set search_path = public, private as $$
declare f uuid; l uuid; tel text := nullif(auth.jwt() ->> 'phone', ''); mail text := nullif(auth.jwt() ->> 'email', '');
begin
  if auth.uid() is null then raise exception 'connexion_requise' using errcode = 'P0001'; end if;
  if private.mon_foyer() is not null then raise exception 'deja_membre' using errcode = 'P0001'; end if;
  insert into public.foyers (nom, proprio) values (coalesce(nullif(trim(p_nom), ''), 'Mon foyer'), auth.uid()) returning id into f;
  insert into public.membres (foyer_id, nom, email, telephone, invite_par, role)
    values (f, trim(coalesce(p_prenom, '')), mail, case when tel is null then null else '+' || regexp_replace(tel, '\D', '', 'g') end, 'creation', 'proprio');
  insert into public.config (foyer_id) values (f);
  insert into public.lieux (foyer_id, nom, ordre) values (f, 'Maison', 1) returning id into l;
  insert into public.espaces (foyer_id, lieu_id, nom, ordre)
    select f, l, n, o from (values ('Garde-manger',1),('Réfrigérateur',2),('Congélateur',3),('Sous-sol',4)) v(n, o);
  insert into public.listes (foyer_id, nom, ordre) values (f, 'Épicerie', 1);
  return f;
end $$;
revoke all on function public.creer_foyer(text, text) from public, anon;
grant execute on function public.creer_foyer(text, text) to authenticated;

-- =========================================================
-- 9. Photos : chaque foyer dans son dossier (les anciennes photos restent au foyer fondateur)
-- =========================================================
drop policy if exists photos_membres_lecture on storage.objects;
drop policy if exists photos_membres_ajout on storage.objects;
drop policy if exists photos_membres_suppression on storage.objects;
create policy photos_membres_lecture on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.mon_foyer() is not null and (
    (storage.foldername(name))[1] = private.mon_foyer()::text
    or private.mon_foyer() = (select id from public.foyers order by cree limit 1)));
create policy photos_membres_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = private.mon_foyer()::text and private.foyer_actif());
create policy photos_membres_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = private.mon_foyer()::text);
