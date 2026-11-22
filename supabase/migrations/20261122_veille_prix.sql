-- Lecture commune des circulaires : ce que l'agent a trouvé pour un produit (clé nom|marque|format),
-- pour la semaine qui commence ce jeudi-là. Partagée entre tous les foyers ; écrite et lue par l'agent seulement.
create table if not exists public.veille_prix (
  cle text not null,
  semaine date not null,
  resultat jsonb not null default '{}'::jsonb,
  magasins text[] not null default '{}',
  maj timestamptz not null default now(),
  primary key (cle, semaine)
);
alter table public.veille_prix enable row level security;
revoke all on public.veille_prix from anon, authenticated;
