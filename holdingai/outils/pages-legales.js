#!/usr/bin/env node
// Pages légales communes des apps de L'Établi : Politique de confidentialité et Conditions d'utilisation.
// Toutes les apps ont les mêmes sections, dans le même ordre, avec les mêmes phrases ; seule la fiche de l'app change.
//
// Utilisation : node pages-legales.js <fiche.json> <dossier-du-site>
//   écrit <dossier-du-site>/confidentialite.html et <dossier-du-site>/conditions.html
//
// La fiche (JSON) : voir l'exemple dans pages-legales.exemple.json.
// Le modèle et ses règles sont décrits dans le livre de marque (section « Les pages légales »).
'use strict';
const fs = require('fs');
const path = require('path');

const [, , ficheChemin, dossier] = process.argv;
if (!ficheChemin || !dossier) {
  console.error('Utilisation : node pages-legales.js <fiche.json> <dossier-du-site>');
  process.exit(1);
}
const a = JSON.parse(fs.readFileSync(ficheChemin, 'utf8'));

// ---- Les champs obligatoires de la fiche
const requis = ['nom', 'deNom', 'leNom', 'courriel', 'app', 'symbole', 'marque', 'douce', 'police', 'policeGoogle',
  'unite', 'recueil', 'pourquoi', 'fournisseurs', 'conservation', 'service', 'formules', 'prix', 'remboursement', 'exactitude'];
const manque = requis.filter(k => a[k] === undefined);
if (manque.length) { console.error('Champs manquants dans la fiche : ' + manque.join(', ')); process.exit(1); }

// ---- L'entreprise : la même pour toutes les apps
const ENTREPRISE = {
  nom: 'Les Stratégies Vortex Inc.',
  marque: 'L’Établi',
  adresse: '[adresse]',
  neq: '[numéro]',
  responsable: '[Prénom Nom], [titre]',
  enVigueur: '[date]',
};

const liste = items => `<ul>\n${items.map(x => `  <li>${x}</li>`).join('\n')}\n</ul>`;
const courriel = `<a href="mailto:${a.courriel}">${a.courriel}</a>`;
const U = a.unite;                       // « groupe » ou « foyer »
const Ud = /^[aeiouhé]/i.test(U) ? `l’${U}` : `le ${U}`;
const duU = /^[aeiouhé]/i.test(U) ? `de l’${U}` : `du ${U}`;

function page(titre, avertissement, corps) {
  return `<!DOCTYPE html>
<html lang="fr-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} · ${a.nom}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${a.favicon || a.symbole}">
<link href="https://fonts.googleapis.com/css2?family=${a.policeGoogle}&display=swap" rel="stylesheet">
<style>
/* Pages légales communes de L’Établi (outil pages-legales.js) : ne pas modifier à la main, refaire avec l’outil. */
body { margin: 0; background: #FAF6EF; color: #1D1B18; font: 17px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
a { color: ${a.marque}; }
.entete { background: #fff; border-bottom: 1px solid #E6DED2; }
.wrap { max-width: 760px; margin: 0 auto; padding: 0 24px; }
.entete .wrap { display: flex; align-items: center; justify-content: space-between; height: 64px; }
.marque { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #1D1B18; font: 700 22px ${a.police}; }
.marque img { width: 30px; height: 30px; }
main { padding-top: 48px; padding-bottom: 64px; }
h1 { font: 700 clamp(32px, 5vw, 42px)/1.1 ${a.police}; margin: 0 0 16px; }
h2 { font: 700 22px ${a.police}; margin: 32px 0 8px; }
.avertissement { background: ${a.douce}; border-radius: 12px; padding: 12px 16px; font-size: 15px; }
.vigueur { color: #6B665E; }
ul { padding-left: 22px; }
li { margin: 4px 0; }
.pied { background: #fff; border-top: 1px solid #E6DED2; padding: 28px 0; font-size: 15px; color: #6B665E; }
.pied .liens { display: flex; gap: 20px; flex-wrap: wrap; margin-bottom: 8px; }
.pied a { color: #1D1B18; }
</style>
</head>
<body>
<header class="entete"><div class="wrap"><a class="marque" href="${a.accueil || './'}"><img src="${a.symbole}" alt="">${a.nom}</a><a href="${a.app}">Se connecter</a></div></header>
<main class="wrap">
<h1>${titre}</h1>
<p class="avertissement">${avertissement}</p>
${corps}
</main>
<footer class="pied"><div class="wrap">
<div class="liens"><a href="${a.accueil || './'}">${a.nom}</a><a href="confidentialite.html">Confidentialité</a><a href="conditions.html">Conditions</a><a href="mailto:${a.courriel}">Nous écrire</a><a href="https://letabli.ai/#apps">Les autres apps de L’Établi</a></div>
© 2026 ${ENTREPRISE.marque} (${ENTREPRISE.nom}). Fait au Québec.
</div></footer>
</body>
</html>
`;
}

// ===================== Politique de confidentialité =====================
const confidentialite = page('Politique de confidentialité',
  'Version de travail. À faire valider avant l’ouverture des ventes, en conformité avec la Loi sur la protection des renseignements personnels dans le secteur privé (Loi 25). Les éléments entre crochets sont à compléter.',
  `<p class="vigueur">En vigueur le ${ENTREPRISE.enVigueur}. Cette politique explique quels renseignements ${a.nom} recueille, pourquoi, qui y a accès et comment exercer vos droits.</p>

<h2>1. Responsable de la protection des renseignements personnels</h2>
<p>${ENTREPRISE.responsable}, ${ENTREPRISE.nom} (${ENTREPRISE.marque}). Courriel : ${courriel}.</p>

<h2>2. Ce que nous recueillons</h2>
${liste([...a.recueil,
  'Compte : la connexion se fait avec le compte commun des apps de L’Établi (compte.letabli.ai), lié à votre numéro de cellulaire.',
  'Technique : données de connexion nécessaires au fonctionnement de l’app. Nous n’utilisons ni témoins publicitaires ni outils de pistage.'])}

<h2>3. Pourquoi</h2>
${liste(a.pourquoi)}
<p>Nous n’utilisons pas vos renseignements à d’autres fins sans votre consentement, et nous ne les vendons jamais.</p>

<h2>4. Consentement</h2>
<p>La personne qui ajoute quelqu’un ${duU} doit avoir son accord. Chaque personne peut retirer son consentement en tout temps en demandant son retrait ${duU}.</p>

<h2>5. Qui y a accès</h2>
${liste([
  `Les membres connectés de votre ${U} voient les renseignements de ce ${U} seulement.`,
  `Nos fournisseurs, uniquement pour fournir le service : ${a.fournisseurs}. Ces fournisseurs peuvent conserver des données à l’extérieur du Québec, notamment aux États-Unis. Nous avons évalué que leurs protections sont adéquates avant de leur confier vos renseignements.`])}

<h2>6. Conservation</h2>
<p>${a.conservation}</p>

<h2>7. Vos droits</h2>
<p>Vous pouvez demander l’accès à vos renseignements, leur correction, leur effacement, la fin de leur diffusion ou leur transfert dans un format courant. Écrivez à ${courriel} ; nous répondons dans les 30 jours. Vous pouvez aussi porter plainte auprès de la Commission d’accès à l’information du Québec.</p>

<h2>8. Sécurité et incidents</h2>
<p>L’accès aux données est protégé par une connexion et des règles qui limitent chaque ${U} à ses propres données. En cas d’incident de confidentialité qui présente un risque de préjudice sérieux, nous avisons les personnes touchées et la Commission d’accès à l’information.</p>

<h2>9. Ce site</h2>
<p>Ce site n’utilise aucun témoin. Les polices de caractères sont servies par Google Fonts, qui reçoit l’adresse IP de votre appareil pour les afficher.</p>

<h2>10. Modifications</h2>
<p>Nous publierons ici toute modification et vous en aviserons par courriel si elle est importante.</p>`);

// ===================== Conditions d'utilisation =====================
let n = 1;
const s = titre => `<h2>${n++}. ${titre}</h2>`;
const conditions = page('Conditions d’utilisation',
  'Version de travail. À faire valider par un avocat avant l’ouverture des ventes. Les éléments entre crochets sont à compléter.',
  `<p class="vigueur">En vigueur le ${ENTREPRISE.enVigueur}. Ces conditions encadrent l’utilisation ${a.deNom}${a.prixPayant ? ' et l’achat d’un forfait' : ''}.</p>

${s('Qui sommes-nous')}
<p>${a.nom} est offert par ${ENTREPRISE.nom} (${ENTREPRISE.marque}), ${ENTREPRISE.adresse}, Québec, numéro d’entreprise du Québec (NEQ) ${ENTREPRISE.neq}. Courriel : ${courriel}.</p>

${s('Le service')}
<p>${a.service}</p>
${liste(a.formules)}

${s('Prix et paiement')}
${liste(a.prix)}

${s(`Propriétaire ${duU}`)}
<p>La personne qui crée ${Ud} en est propriétaire : elle invite ou retire des membres${a.organisateurs ? ' et peut nommer des organisateurs' : ''}${a.prixPayant ? ', et c’est elle qui achète le forfait' : ''}.</p>

${s('Remboursement')}
<p>${a.remboursement}</p>
${a.particularite ? `\n${s(a.particularite.titre)}\n<p>${a.particularite.texte}</p>\n` : ''}
${s('Utilisation acceptable')}
${liste([
  `Ajoutez seulement des personnes qui acceptent de faire partie ${duU}${a.textos ? ' et de recevoir des textos de celui-ci' : ''}.`,
  `N’utilisez pas ${a.leNom} pour envoyer des messages non désirés ou pour un usage commercial non autorisé.`,
  `Nous pouvons suspendre ${Ud} qui ne respecte pas ces conditions, après vous en avoir avisé.`])}

${s('Exactitude et disponibilité')}
<p>${a.exactitude} Nous faisons notre possible pour que l’app soit disponible en tout temps, mais des interruptions peuvent survenir.</p>

${s('Responsabilité')}
<p>${a.prixPayant ? 'Notre responsabilité envers vous est limitée au montant payé pour le forfait en cours' : 'Le service étant offert gratuitement, notre responsabilité envers vous est limitée dans toute la mesure permise par la loi'}, sauf en cas de faute lourde ou intentionnelle de notre part, ou lorsque la loi ne permet pas une telle limite.</p>

${s('Modifications')}
<p>Nous pouvons modifier ces conditions. Nous vous aviserons par courriel au moins 30 jours avant qu’un changement important s’applique.${a.prixPayant ? ' Un forfait déjà payé reste régi par les conditions en vigueur lors de l’achat, sauf si le changement vous est favorable.' : ''}</p>

${s('Lois applicables')}
<p>Ces conditions sont régies par les lois du Québec et du Canada qui s’y appliquent.</p>`);

fs.writeFileSync(path.join(dossier, 'confidentialite.html'), confidentialite);
fs.writeFileSync(path.join(dossier, 'conditions.html'), conditions);
console.log(`${a.nom} : confidentialite.html et conditions.html écrits dans ${dossier}`);
