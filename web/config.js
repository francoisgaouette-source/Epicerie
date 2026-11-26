// Remplacez ces deux valeurs par celles de votre projet Supabase
// (Supabase > Project Settings > API). La clé « anon » est publique :
// elle peut être dans le code, la sécurité vient des règles de la base.
window.EPICERIE_CONFIG = {
  supabaseUrl: "https://gandliltstmtfsmsjaew.supabase.co",
  siteUrl: "https://lecommis.ai/", // site de vente : page Acheter et conditions
  supabaseAnonKey: "sb_publishable_8b0VbS6YyEf5vrsn5u9m4Q_JJZ1vkmP",
  // Compte HoldingAI (compte.letabli.ai) : client OAuth du Commis dans le projet Supabase « HoldingAI Compte »
  HOLDINGAI: {
    clientId: "e4da9233-70d1-48cb-927b-25203475c312",
    app: "le-commis",
    retour: "https://app.lecommis.ai/"
  }
};
