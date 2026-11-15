-- Console HoldingAI : courriels reçus à @holdingai.app, @lecommis.ai et @fanion.ai, et réponses envoyées de la console.
-- Migration « console_courriels ». Lecture et écriture par les fonctions serveur seulement (clé de service).
create table if not exists public.console_courriels (
  id uuid primary key default gen_random_uuid(),
  cree timestamptz not null default now(),
  sens text not null check (sens in ('recu', 'envoye')),
  app text not null check (app in ('holdingai', 'commis', 'fanion')),
  de text not null,            -- adresse de l'expéditeur
  de_nom text,
  a text not null,             -- adresse du destinataire
  repondre_a text,             -- en-tête Reply-To, s'il y en a un
  sujet text not null default '',
  texte text not null default '',
  message_id text unique,      -- en-tête Message-ID : évite de noter deux fois le même message
  en_reponse_a text,
  refs text,
  fil uuid not null default gen_random_uuid(),  -- les messages d'un même échange partagent le même fil
  pieces jsonb not null default '[]'::jsonb,    -- noms et tailles des pièces jointes (le contenu reste dans la copie Gmail)
  auto boolean not null default false,          -- message automatique (avis d'un service, infolettre)
  tronque boolean not null default false,
  copie boolean,                                -- la copie vers la boîte personnelle est partie
  traite boolean not null default false,
  traite_par uuid,
  traite_le timestamptz,
  envoye_par uuid
);
create index if not exists console_courriels_cree on public.console_courriels (cree desc);
create index if not exists console_courriels_fil on public.console_courriels (fil);
alter table public.console_courriels enable row level security;
revoke all on public.console_courriels from anon, authenticated;
