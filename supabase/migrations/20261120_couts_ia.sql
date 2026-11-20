-- Coût de chaque appel à l'API Claude, par app, fonction et foyer.
-- Écrit seulement par les fonctions serveur (clé service) ; lu par la console.
create table if not exists public.couts_ia (
  id bigserial primary key,
  cree timestamptz not null default now(),
  app text not null default 'commis',
  fonction text not null,
  foyer_id uuid references public.foyers(id) on delete set null,
  modele text not null,
  entree integer not null default 0,
  sortie integer not null default 0,
  cache_ecrit integer not null default 0,
  cache_lu integer not null default 0,
  recherches integer not null default 0,
  cout_usd numeric(12,6) not null default 0
);
create index if not exists couts_ia_cree on public.couts_ia (cree desc);
create index if not exists couts_ia_foyer on public.couts_ia (foyer_id);
alter table public.couts_ia enable row level security;
revoke all on public.couts_ia from anon, authenticated;

-- config est publiée en temps réel sans clé primaire : Postgres refusait toute mise à jour
-- (« cannot update table "config" because it does not have a replica identity »).
alter table public.config replica identity full;
