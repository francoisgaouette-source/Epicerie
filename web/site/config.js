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
  temoignages: []
};
