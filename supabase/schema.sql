-- Notre épicerie : schéma Supabase
-- Déjà appliqué au projet « Notre épicerie » (gandliltstmtfsmsjaew). Gardé ici comme référence
-- ou pour recréer la base : Supabase > SQL Editor > New query, puis « Run ».
-- Seules les adresses inscrites dans la table `membres` peuvent lire ou modifier les données.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Membres du ménage
-- ---------------------------------------------------------------
create table if not exists public.membres (
  email text primary key,
  nom   text not null default ''
);

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.est_membre()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.membres
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function private.est_membre() from public, anon;
grant execute on function private.est_membre() to authenticated;

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------
create table if not exists public.epicerie (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null,
  qte   text not null default '',
  fait  boolean not null default false,
  par   text default (auth.jwt() ->> 'email'),
  cree  timestamptz not null default now()
);

create table if not exists public.surveiller (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  prix_cible numeric,
  par        text default (auth.jwt() ->> 'email'),
  cree       timestamptz not null default now()
);

-- prix = { "IGA": {"reg": 4.99, "special": 3.49, "finSpecial": "2026-11-11",
--                  "maj": "2026-11-05", "par": "agent", "source": "https://..."}, ... }
create table if not exists public.produits (
  id        uuid primary key default gen_random_uuid(),
  nom       text not null,
  marque    text not null default '',
  format    text not null default '',
  categorie text not null default 'Autre',
  prix      jsonb not null default '{}'::jsonb,
  cree      timestamptz not null default now()
);
create unique index if not exists produits_nom_unique on public.produits (lower(nom));

create table if not exists public.speciaux (
  id       uuid primary key default gen_random_uuid(),
  item     text not null,          -- nom exact de l'article surveillé
  magasin  text not null,
  prix     numeric,
  prix_reg numeric,
  detail   text not null default '',
  debut    date,
  fin      date,
  lien     text not null default '',
  semaine  text not null default '',
  trouve   timestamptz not null default now(),
  ignore   boolean not null default false
);

-- Une seule ligne : réglages + état de l'agent
create table if not exists public.config (
  id             int primary key default 1 check (id = 1),
  magasins       text[] not null default array['IGA','Metro','Maxi','Super C','Provigo'],
  region         text not null default 'Montréal, QC',
  derniere_verif timestamptz,
  semaine        text,
  resume         text
);
insert into public.config (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- Mise à jour du prix d'un produit dans un magasin, sans écraser les autres
-- ---------------------------------------------------------------
create or replace function public.maj_prix(p_id uuid, p_magasin text, p_entree jsonb)
returns void
language sql security invoker
set search_path = public
as $$
  update public.produits
     set prix = prix || jsonb_build_object(
           p_magasin,
           coalesce(prix -> p_magasin, '{}'::jsonb) || p_entree)
   where id = p_id;
$$;
revoke execute on function public.maj_prix(uuid, text, jsonb) from anon, public;
grant execute on function public.maj_prix(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------
-- Sécurité (RLS) : membres seulement
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['epicerie','surveiller','produits','speciaux','config'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists membres_tout on public.%I', t);
    execute format('create policy membres_tout on public.%I for all to authenticated using (private.est_membre()) with check (private.est_membre())', t);
  end loop;
end $$;

alter table public.membres enable row level security;
drop policy if exists membres_lecture on public.membres;
create policy membres_lecture on public.membres for select to authenticated using (private.est_membre());

-- ---------------------------------------------------------------
-- Temps réel : les changements apparaissent aussitôt chez l'autre personne
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['epicerie','surveiller','produits','speciaux','config'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Membres du ménage (les vraies adresses sont déjà dans la base;
-- elles ne sont pas inscrites ici pour ne pas les publier)
-- ---------------------------------------------------------------
insert into public.membres (email, nom) values
  ('premiere-adresse@exemple.com', 'Prénom 1'),
  ('deuxieme-adresse@exemple.com', 'Prénom 2')
on conflict (email) do update set nom = excluded.nom;

-- ---------------------------------------------------------------
-- Photos des articles et des produits (stockage privé, membres seulement)
-- ---------------------------------------------------------------
alter table public.epicerie add column if not exists photo text;
alter table public.produits add column if not exists photo text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists photos_membres_lecture on storage.objects;
drop policy if exists photos_membres_ajout on storage.objects;
drop policy if exists photos_membres_suppression on storage.objects;
create policy photos_membres_lecture on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.est_membre());
create policy photos_membres_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and private.est_membre());
create policy photos_membres_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and private.est_membre());

-- ---------------------------------------------------------------
-- Maison : espaces de rangement et réserves
-- ---------------------------------------------------------------
create table if not exists public.espaces (
  id    uuid primary key default gen_random_uuid(),
  nom   text not null,
  ordre int  not null default 0,
  cree  timestamptz not null default now()
);
insert into public.espaces (nom, ordre)
select * from (values ('Garde-manger',1),('Réfrigérateur',2),('Congélateur',3),('Sous-sol',4),('Salle de bain',5)) v(nom, ordre)
where not exists (select 1 from public.espaces);

alter table public.produits add column if not exists espace_id uuid references public.espaces(id) on delete set null;
alter table public.produits add column if not exists stock numeric not null default 0;
alter table public.produits add column if not exists minimum numeric;
create index if not exists produits_espace_idx on public.produits(espace_id);

alter table public.espaces enable row level security;
drop policy if exists membres_tout on public.espaces;
create policy membres_tout on public.espaces for all to authenticated
  using (private.est_membre()) with check (private.est_membre());

do $$ begin
  alter publication supabase_realtime add table public.espaces;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- Invitations : les membres ajoutent ou retirent des membres, maximum 4
-- ---------------------------------------------------------------
alter table public.membres add column if not exists invite_par text;
alter table public.membres add column if not exists cree timestamptz not null default now();

create or replace function private.verifier_membres()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.email := lower(trim(new.email));
    new.nom := trim(coalesce(new.nom, ''));
    if new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'courriel_invalide' using errcode = 'P0001';
    end if;
    if (select count(*) from public.membres) >= 4 then
      raise exception 'limite_membres' using errcode = 'P0001';
    end if;
    if new.invite_par is null then new.invite_par := auth.jwt() ->> 'email'; end if;
    return new;
  elsif tg_op = 'DELETE' then
    if (select count(*) from public.membres) <= 1 then
      raise exception 'dernier_membre' using errcode = 'P0001';
    end if;
    return old;
  end if;
  return new;
end $$;
revoke all on function private.verifier_membres() from public, anon, authenticated;

drop trigger if exists membres_verif_ins on public.membres;
create trigger membres_verif_ins before insert on public.membres for each row execute function private.verifier_membres();
drop trigger if exists membres_verif_del on public.membres;
create trigger membres_verif_del before delete on public.membres for each row execute function private.verifier_membres();

drop policy if exists membres_ajout on public.membres;
create policy membres_ajout on public.membres for insert to authenticated with check (private.est_membre());
drop policy if exists membres_retrait on public.membres;
create policy membres_retrait on public.membres for delete to authenticated using (private.est_membre());
drop policy if exists membres_modif on public.membres;
create policy membres_modif on public.membres for update to authenticated using (private.est_membre()) with check (private.est_membre());

do $$ begin
  alter publication supabase_realtime add table public.membres;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- Factures : panier à approuver et date de péremption
-- ---------------------------------------------------------------
alter table public.produits add column if not exists peremption date;

create table if not exists public.panier (
  id            uuid primary key default gen_random_uuid(),
  lot           uuid not null,
  magasin       text not null default '',
  date_achat    date,
  texte         text not null default '',
  produit_id    uuid references public.produits(id) on delete set null,
  nom           text not null,
  marque        text not null default '',
  format        text not null default '',
  categorie     text not null default 'Autre',
  quantite      numeric not null default 1,
  prix_unitaire numeric,
  prix_total    numeric,
  espace_id     uuid references public.espaces(id) on delete set null,
  peremption    date,
  confiance     text not null default 'moyenne',
  photo         text,
  par           text default (auth.jwt() ->> 'email'),
  cree          timestamptz not null default now()
);
alter table public.panier enable row level security;
drop policy if exists membres_tout on public.panier;
create policy membres_tout on public.panier for all to authenticated
  using (private.est_membre()) with check (private.est_membre());
do $$ begin
  alter publication supabase_realtime add table public.panier;
exception when duplicate_object then null; end $$;
