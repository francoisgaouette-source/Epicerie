# Notre épicerie

Liste d'épicerie partagée à deux, installable sur le téléphone, avec :

- la **liste** en temps réel (ce que l'un ajoute, l'autre le voit aussitôt);
- les articles **à surveiller**, qu'on achète seulement en spécial;
- les **spéciaux** trouvés chaque jeudi dans les circulaires d'IGA, Metro, Maxi, Super C et Provigo;
- un **catalogue de produits** avec le prix dans chaque épicerie et le magasin le moins cher pour la liste en cours;
- l'**ajout par photo** : on photographie un produit, Claude l'identifie et la photo reste jointe à l'article.

## Comment c'est bâti

| Morceau | Service | Coût |
|---|---|---|
| Application web (dossier `web/`) | Netlify | gratuit |
| Base de données et connexion par courriel | Supabase | gratuit |
| Agent du jeudi (dossier `agent/`) | GitHub Actions | gratuit (quelques minutes par semaine) |
| Recherche dans les circulaires | API d'Anthropic | quelques dollars par mois, selon le nombre de produits |

---

## Mise en ligne (environ 30 minutes)

### 1. Supabase : la base de données (déjà faite)

Le projet **Notre épicerie** existe déjà dans votre organisation Supabase, avec les tables, la sécurité, le temps réel et vos deux adresses comme membres. `web/config.js` contient déjà son adresse et sa clé publique. Il reste deux réglages à faire dans le tableau de bord Supabase :

1. **Authentication > Emails > Templates > Magic Link** : remplacez le contenu du courriel par :
   ```html
   <h2>Votre code Notre épicerie</h2>
   <p>Entrez ce code dans l'application :</p>
   <p style="font-size:28px;letter-spacing:6px"><b>{{ .Token }}</b></p>
   ```
   L'application utilise un code à 6 chiffres plutôt qu'un lien, parce qu'un lien s'ouvrirait dans le navigateur au lieu de l'app installée.
2. **Project Settings > API Keys** : copiez la clé secrète (**service_role**, ou une clé « secret » `sb_secret_…`). Elle servira à l'étape 4, uniquement dans les secrets GitHub.

### 2. Le code sur GitHub

1. Créez un dépôt **privé** sur GitHub, par exemple `notre-epicerie`.
2. Envoyez tout le dossier dans le dépôt (avec GitHub Desktop, ou par glisser-déposer sur la page du dépôt avec **Add file > Upload files**; le dossier `.github` doit être inclus).

### 3. Netlify : l'application

1. Sur [netlify.com](https://netlify.com) : **Add new site > Import an existing project > GitHub**, puis choisissez le dépôt.
2. Laissez les réglages tels quels (le fichier `netlify.toml` indique de publier le dossier `web`). Cliquez sur **Deploy**.
3. Facultatif : **Site configuration > Change site name** pour une adresse comme `notre-epicerie.netlify.app`.
4. Dans Supabase, **Authentication > URL Configuration > Site URL** : collez l'adresse Netlify.

Chaque fois que vous modifiez le code sur GitHub, Netlify republie l'app automatiquement.

### 4. L'agent du jeudi

1. Créez une clé sur [console.anthropic.com](https://console.anthropic.com) (**API Keys**) et ajoutez un peu de crédit. Réglez une limite de dépense mensuelle (par exemple 10 $) dans **Limits**.
2. Dans le dépôt GitHub : **Settings > Secrets and variables > Actions > New repository secret**, et ajoutez :
   - `ANTHROPIC_API_KEY` : la clé Anthropic;
   - `SUPABASE_URL` : `https://gandliltstmtfsmsjaew.supabase.co`;
   - `SUPABASE_SERVICE_ROLE_KEY` : la clé secrète copiée à l'étape 1.
3. Pour tester tout de suite : onglet **Actions > Circulaires de la semaine > Run workflow**. Le rapport s'affiche dans le résumé de l'exécution, et les résultats apparaissent dans l'app.

L'agent roule ensuite tout seul chaque jeudi matin.

**Réglages facultatifs** (dans **Settings > Secrets and variables > Actions > Variables**) :
- `MAX_PRODUITS` : nombre de produits dont les prix sont vérifiés chaque semaine (30 par défaut). Les articles surveillés sont toujours vérifiés.
- `MODEL` : modèle Claude utilisé (`claude-sonnet-5-5` par défaut).

### 5. Installer l'app sur le téléphone

- **iPhone** : ouvrez l'adresse Netlify dans Safari, bouton Partager, puis **Sur l'écran d'accueil**.
- **Android** : ouvrez l'adresse dans Chrome, menu ⋮, puis **Installer l'application**.

Connectez-vous avec votre courriel et le code reçu. Seules les adresses inscrites dans la table `membres` ont accès.

---

## Ajout par photo

Le bouton appareil photo à gauche du champ « Ajouter un article » ouvre la caméra. La photo est réduite, envoyée dans le stockage privé de Supabase, puis analysée par la fonction `identifier-produit` (dossier `supabase/functions/`), qui propose le nom, la marque, le format et la catégorie. On peut corriger le nom avant d'appuyer sur « Ajouter ». La photo s'affiche dans la liste et dans le catalogue; touchez-la pour l'agrandir.

La fonction a besoin du secret `ANTHROPIC_API_KEY` dans Supabase (**Edge Functions > Secrets**). Chaque photo coûte une fraction de cent.

## Bon à savoir

- **Ajouter ou retirer une personne** : Supabase > Table Editor > `membres`.
- **Prix réguliers** : l'agent les lit sur les sites des épiceries, qui affichent souvent les prix d'une succursale de référence. Ils peuvent différer un peu de ceux de votre magasin. Un prix corrigé à la main n'est pas écrasé par l'agent pendant 30 jours.
- **Coût de l'agent** : chaque produit vérifié demande quelques recherches web. Si la facture monte, baissez `MAX_PRODUITS`.
- **Sécurité** : la clé `anon` dans `config.js` est faite pour être publique; ce sont les règles de la base (RLS) qui limitent l'accès à vos deux adresses. Ne mettez jamais la clé `service_role` dans le dossier `web`.

## Structure

```
web/                  l'application (HTML, CSS, JS, icônes, manifeste, service worker)
supabase/schema.sql   tables, sécurité et temps réel
agent/                script de l'agent du jeudi
.github/workflows/    planification de l'agent dans GitHub Actions
netlify.toml          réglages Netlify
```
