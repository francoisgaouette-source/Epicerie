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
