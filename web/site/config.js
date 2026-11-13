// Réglages du site Le Commis : la seule chose à modifier pour ouvrir les ventes.
window.COMMIS = {
  // Lien de paiement Stripe (Payment Link), ex. 'https://buy.stripe.com/abc123'.
  // Laisser vide tant que les ventes ne sont pas ouvertes : le bouton Payer reste désactivé.
  stripeLink: '',
  // Prix avant taxes, par année, pour tout le foyer
  prix: '19,99 $',
  // Adresse de l'app
  appUrl: 'https://app.lecommis.ai/',
  // Courriel de contact
  email: 'bonjour@lecommis.ai',
  // Vrais témoignages seulement, avec l'accord écrit de la personne (case cochée dans l'app ou courriel).
  // Exemple : { texte: "…", prenom: "Marie-Eve", ville: "Montréal" }
  temoignages: [],
  // Avis approuvés dans la console HoldingAI (console.holdingai.app) : lus ici, rien à modifier.
  avisUrl: 'https://gandliltstmtfsmsjaew.supabase.co/rest/v1/rpc/temoignages_publies',
  avisCle: 'sb_publishable_8b0VbS6YyEf5vrsn5u9m4Q_JJZ1vkmP'
};
