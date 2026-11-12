// Réglages du site Le Commis : la seule chose à modifier pour ouvrir les ventes.
window.COMMIS = {
  // Lien de paiement Stripe (Payment Link), ex. 'https://buy.stripe.com/abc123'.
  // Laisser vide tant que les ventes ne sont pas ouvertes : le bouton Payer reste désactivé.
  stripeLink: '',
  // Prix avant taxes, par année, pour tout le foyer
  prix: '7,99 $',
  // Adresse de l'app
  appUrl: 'https://lecommis.netlify.app/', // temporaire : revenir à https://app.lecommis.ai/ quand son certificat HTTPS est actif
  // Courriel de contact
  email: 'bonjour@lecommis.ai'
};
