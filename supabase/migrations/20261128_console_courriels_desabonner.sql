-- Console : se désabonner d'une liste d'envoi, bloquer un expéditeur et effacer des courriels.
-- Ajouts seulement : aucune donnée existante n'est modifiée.

-- Lien de désabonnement fourni par l'expéditeur (en-têtes List-Unsubscribe et List-Unsubscribe-Post, RFC 8058)
alter table public.console_courriels
  add column if not exists desabonner_url text,
  add column if not exists desabonner_mailto text,
  add column if not exists desabonner_un_clic boolean not null default false,
  add column if not exists desabonne_le timestamptz;

-- Expéditeurs bloqués : leurs prochains courriels ne sont plus notés dans la console.
-- « adresse » est une adresse complète (ex. promo@exemple.com) ou un domaine précédé de @ (ex. @exemple.com).
create table if not exists public.console_bloques (
  adresse text primary key check (adresse = lower(adresse) and length(adresse) between 3 and 254),
  cree timestamptz not null default now(),
  par uuid
);
-- Lue et écrite seulement par les fonctions de la console (clé de service) : aucune politique, donc aucun accès direct.
alter table public.console_bloques enable row level security;
