Fonction « lire-facture » (déployée sur Supabase).
Reçoit 1 à 4 photos d'une facture, les fait lire par Claude et renvoie les articles
(nom, quantité, prix, espace suggéré, date de péremption estimée) pour le panier à approuver.
Le code source déployé est consultable dans Supabase > Edge Functions > lire-facture.
Secret requis : ANTHROPIC_API_KEY.
