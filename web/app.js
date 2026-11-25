(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const cfg = window.EPICERIE_CONFIG || {};
  // Compte HoldingAI : la base du Commis reconnaît le jeton HoldingAI (Third-Party Auth). Plus de connexion propre au Commis.
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { accessToken: async () => (await HoldingAI.jeton()) || null });
  async function sessionHAI() {
    const s = await HoldingAI.session(); if (!s || !s.uid) return null;
    return { user: { id: s.uid, email: s.email || null, phone: s.phone || null, nom: s.nom || "", created_at: null } };
  }
  async function deconnecter() { HoldingAI.deconnexion(); current = null; await onSession(null); }

  const DEFAULT_STORES = ["IGA", "Metro", "Maxi", "Super C", "Provigo"];
  const CATS = ["Fruits et légumes", "Viandes et poissons", "Produits laitiers et œufs", "Boulangerie", "Épicerie sèche",
    "Surgelés", "Boissons", "Collations", "Hygiène et beauté", "Entretien ménager", "Autre"];
  // Ajout simple : « lait 2 % 2 L » → nom « Lait 2 % », format « 2 L » ; la catégorie est devinée d'après le nom
  function separerFormat(txt) {
    const t = String(txt || "").trim().replace(/\s+/g, " ");
    const m = t.match(/\s((?:\d+\s*[x×]\s*)?\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|cl|l|lb|lbs|oz|un|unités?|pqt|sacs?|boîtes?|douz(?:aine)?s?))$/i);
    const nom = (m ? t.slice(0, m.index) : t).trim();
    return { nom: nom ? nom.charAt(0).toUpperCase() + nom.slice(1) : "", format: m ? m[1].replace(/\s*([x×])\s*/i, " x ").replace(/(\d)\s*(?=[a-zA-Zé])/, "$1 ") : "" };
  }
  const MOTS_CAT = [
    ["Fruits et légumes", "pomme banane orange citron lime fraise framboise bleuet raisin melon ananas mangue avocat poire peche prune kiwi tomate laitue salade epinard chou brocoli carotte celeri concombre courgette poivron oignon ail patate champignon persil coriandre basilic fruit legume radis betterave courge asperge haricot"],
    ["Viandes et poissons", "poulet boeuf porc veau agneau dinde jambon bacon saucisse steak viande hache filet poisson saumon thon crevette morue tilapia truite pepperoni salami charcuterie cotelette"],
    ["Produits laitiers et œufs", "lait creme beurre fromage yogourt yaourt oeuf oeufs cheddar mozzarella parmesan feta cottage kefir margarine"],
    ["Boulangerie", "pain baguette bagel croissant muffin tortilla pita brioche gateau tarte biscuit naan"],
    ["Surgelés", "surgele surgeles congele congeles glace frites"],
    ["Boissons", "jus eau the biere vin boisson soda kombucha"],
    ["Collations", "chips croustilles craquelin craquelins chocolat bonbon bonbons noix amande amandes arachides popcorn barre barres granola"],
    ["Hygiène et beauté", "savon shampoing shampooing dentifrice brosse deodorant mouchoir mouchoirs rasoir lotion couche couches papier-hygienique"],
    ["Entretien ménager", "detergent lessive javel nettoyant essuie-tout poubelle eponge vaisselle assouplissant aluminium pellicule"],
    ["Épicerie sèche", "pates pate riz farine sucre sel poivre huile vinaigre cereale cereales gruau conserve soupe sauce ketchup moutarde mayonnaise epice epices levure miel confiture lentilles pois quinoa bouillon cafe spaghetti macaroni"],
  ];
  // Expressions qui l'emportent sur les mots seuls (« beurre d'arachide » n'est pas un produit laitier)
  const EXPR_CAT = [["beurre d'arachide", "Épicerie sèche"], ["papier hygienique", "Hygiène et beauté"], ["creme glacee", "Surgelés"], ["lait d'amande", "Boissons"], ["lait d'avoine", "Boissons"], ["creme solaire", "Hygiène et beauté"], ["sac a poubelle", "Entretien ménager"], ["sacs a poubelle", "Entretien ménager"], ["pomme de terre", "Fruits et légumes"], ["pommes de terre", "Fruits et légumes"], ["fruits de mer", "Viandes et poissons"], ["pizza", "Surgelés"]];
  function devinerCategorie(nom) {
    const n = " " + String(nom || "").toLowerCase().replace(/œ/g, "oe").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z' -]/g, " ").replace(/\s+/g, " ") + " ";
    for (const [e, cat] of EXPR_CAT) if (n.includes(" " + e)) return cat;
    // Le premier mot reconnu l'emporte : « sauce tomate » → épicerie, « tomates cerises » → légumes
    for (const w of n.trim().split(" ")) {
      const formes = [w, w.replace(/s$/, ""), w.replace(/x$/, "")];
      for (const [cat, mots] of MOTS_CAT) if (formes.some((f) => f.length > 1 && (" " + mots + " ").includes(" " + f + " "))) return cat;
    }
    return "Autre";
  }
  const state = { liste: [], listes: [], lieux: [], inv: [], spec: [], prod: [], espaces: [], panier: [], eco: [], config: null, membres: [], email: null };
  let openProd = null, search = "", channel = null, filtre = "tous";
  let editListe = null, brouillonListe = null; // article de la liste en cours de correction
  const surveilles = () => state.prod.filter((p) => p.surveiller && dansLieu(p));

  // ---------- utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const num = (v) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const money = (n) => (typeof n === "number" && isFinite(n)) ? n.toFixed(2).replace(".", ",") + " $" : "";
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const status = (m) => { $("#status").textContent = m || ""; };
  // Épiceries du lieu ouvert (chaque lieu a les siennes) ; à défaut, celles du foyer
  const lieuCourant = () => state.lieux.find((x) => x.id === idLieu());
  const stores = () => { const l = lieuCourant(); if (l && Array.isArray(l.magasins)) return l.magasins;
    return (state.config && Array.isArray(state.config.magasins) && state.config.magasins.length) ? state.config.magasins : DEFAULT_STORES; };
  async function majMagasins(liste) {
    const l = lieuCourant(); if (!l) return false;
    l.magasins = liste; render();
    const ok = await run(sb.from("lieux").update({ magasins: liste }).eq("id", l.id));
    if (!ok) scheduleReload("lieux"); return ok;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso);
    return isNaN(d) ? esc(iso) : d.toLocaleDateString("fr-CA", { day: "numeric", month: "long" });
  }
  const emptyBox = (t, x) => `<div class="empty"><strong>${t}</strong>${x}</div>`;
  const chiffres = (t) => String(t || "").replace(/\D/g, "");
  const tel10 = (t) => { const d = chiffres(t); return d.length === 11 && d[0] === "1" ? d.slice(1) : d; };
  const fmtTel = (t) => { const d = tel10(t); return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}` : (t || ""); };
  const e164 = (t) => { const d = tel10(t); return d.length === 10 ? "+1" + d : ""; };
  const memeContact = (m, id) => !!id && ((m.email && m.email.toLowerCase() === String(id).toLowerCase()) || (m.telephone && chiffres(id).length >= 10 && tel10(m.telephone) === tel10(id)));
  const estMoi = (m) => !!m && ((state.userEmail && m.email && m.email.toLowerCase() === state.userEmail.toLowerCase()) || (state.userPhone && m.telephone && tel10(m.telephone) === tel10(state.userPhone)));
  const nameOf = (par) => {
    if (!par) return "";
    const m = state.membres.find((x) => memeContact(x, par));
    if (m && estMoi(m)) return "toi";
    return (m && m.nom) || "";
  };

  // ---------- photos
  const urls = new Map(); // chemin -> URL signée
  let fetchingUrls = false;
  const photoOf = (item, pm) => item.photo || (pm && (pm.get(norm(item.nom)) || {}).photo) || null;
  async function ensureUrls(paths) {
    const need = [...new Set(paths.filter((p) => p && !urls.has(p)))];
    if (!need.length || fetchingUrls) return;
    fetchingUrls = true;
    try {
      const { data } = await sb.storage.from("photos").createSignedUrls(need, 60 * 60 * 24 * 7);
      (data || []).forEach((d) => { if (d.signedUrl) urls.set(d.path, d.signedUrl); });
      need.forEach((p) => { if (!urls.has(p)) urls.set(p, ""); });
    } catch (e) { console.error(e); }
    fetchingUrls = false;
    render();
  }
  const thumb = (path, alt) => path
    ? `<img class="thumb" src="${esc(urls.get(path) || "")}" alt="${esc(alt)}" data-zoom="${esc(path)}" loading="lazy">`
    : "";

  // Réduit la photo (max 1280 px, JPEG) avant l'envoi
  async function shrink(file, maxPx) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (e) {
      src = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, k = Math.min(1, (maxPx || 1280) / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.82));
    const b64 = c.toDataURL("image/jpeg", 0.82).split(",")[1];
    return { blob, b64 };
  }
  async function uploadPhoto(blob, dossier) {
    const path = `${state.foyer ? state.foyer.id + "/" : ""}${dossier ? dossier + "/" : ""}${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
    const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
    if (error) throw error;
    return path;
  }

  // ---------- prices
  function priceAt(p, store) {
    const e = p && p.prix && p.prix[store]; if (!e) return null;
    const sp = num(e.special), reg = num(e.reg);
    if (sp != null && (!e.finSpecial || e.finSpecial >= today())) return { val: sp, special: true, reg, fin: e.finSpecial };
    if (reg != null) return { val: reg, special: false, reg };
    return null;
  }
  function bestOf(p) {
    let best = null;
    for (const s of stores()) { const pr = priceAt(p, s); if (pr && (!best || pr.val < best.val)) best = { ...pr, store: s }; }
    return best;
  }
  // Un produit appartient à un ou plusieurs lieux (p.lieux) ; sans lieu inscrit, il est partout
  const dansLieu = (p, lid) => !Array.isArray(p.lieux) || !p.lieux.length || p.lieux.includes(lid || idLieu());
  const prodLieu = () => state.prod.filter((p) => dansLieu(p));
  async function ajouterAuLieu(p, lid) {
    lid = lid || idLieu(); if (!p || !lid || dansLieu(p, lid) && Array.isArray(p.lieux) && p.lieux.length) return true;
    p.lieux = [...new Set([...(Array.isArray(p.lieux) ? p.lieux : []), lid])];
    const { error } = await sb.from("produits").update({ lieux: p.lieux }).eq("id", p.id);
    if (error) { console.error(error); scheduleReload("produits"); return false; }
    return true;
  }
  const prodMap = () => { const m = new Map(); state.prod.forEach((p) => m.set(norm(p.nom), p)); return m; };

  // ---------- tabs
  let view = "produits";
  try { const v = localStorage.getItem("vue"); if (v && document.getElementById("v-" + v)) view = v; } catch (e) {}
  function showView(v) {
    view = v;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === v)));
    document.querySelectorAll(".view").forEach((s) => (s.hidden = s.id !== "v-" + v));
    try { localStorage.setItem("vue", v); } catch (e) {}
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));
  showView(view);

  // ---------- render
  // ---------- plusieurs listes
  let listeActive = null;
  try { listeActive = localStorage.getItem("liste-active"); } catch (e) {}
  const listesTriees = () => state.listes.filter((l) => !l.lieu_id || l.lieu_id === idLieu() || !state.lieux.some((x) => x.id === l.lieu_id)).sort((a, b) => (a.ordre - b.ordre) || String(a.cree).localeCompare(String(b.cree)));
  const idListeActive = () => { const l = state.listes.find((x) => x.id === listeActive) || listesTriees()[0]; return l ? l.id : null; };
  const nomListe = (id) => (state.listes.find((x) => x.id === id) || {}).nom || "la liste";
  const listeDe = (p) => (p && p.liste_id && listesTriees().some((l) => l.id === p.liste_id)) ? p.liste_id : idListeActive();
  // L'article non coché de ce produit dans une liste du lieu ouvert (s'il y en a un)
  const dansListeLieu = (p) => { const ids = new Set(listesTriees().map((l) => l.id)); return state.liste.find((i) => !i.fait && ids.has(i.liste_id) && norm(i.nom) === norm(p.nom)); };
  const dansListe = (nom, lid) => state.liste.some((i) => !i.fait && i.liste_id === lid && norm(i.nom) === norm(nom));
  let listeEnEdition = false, listeASupprimer = null;
  function choisirListe(id) { listeActive = id; try { localStorage.setItem("liste-active", id); } catch (e) {} render(); }
  function renderListes() {
    const act = idListeActive(), ls = listesTriees();
    const nb = (id) => state.liste.filter((i) => !i.fait && i.liste_id === id).length;
    $("#listes-bar").innerHTML = ls.map((l) => `<button class="fchip liste-chip" type="button" data-liste="${l.id}" aria-pressed="${l.id === act}">${esc(l.nom)} <span class="count">${nb(l.id)}</span></button>`).join("")
      + `<button class="fchip" type="button" data-liste-new aria-label="Nouvelle liste">＋ Liste</button>`;
    $("#f-nouvelle-liste").hidden = !listeEnEdition;
    const act2 = document.activeElement;
    if (act2 && act2.closest && act2.closest("#list-listes")) return;
    $("#list-listes").innerHTML = ls.map((l, i) => `<li>
        <input id="lst-${l.id}" value="${esc(l.nom)}" aria-label="Nom de la liste" data-listenom="${l.id}">
        <button class="icon" type="button" data-listemove="-1" data-id="${l.id}" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="icon" type="button" data-listemove="1" data-id="${l.id}" aria-label="Descendre" ${i === ls.length - 1 ? "disabled" : ""}>↓</button>
        ${ls.length > 1 ? `<button class="icon" type="button" data-listedel="${l.id}" aria-label="Supprimer ${esc(l.nom)}">✕</button>` : ""}
        ${listeASupprimer === l.id ? `<div class="move-row del-row"><span class="hint">Supprimer « ${esc(l.nom)} »${state.liste.some((x) => x.liste_id === l.id) ? " et ses " + state.liste.filter((x) => x.liste_id === l.id).length + " article(s)" : ""} ?</span>
          <div class="move-choices"><button class="chip-btn danger" type="button" data-listedel-ok="${l.id}">Supprimer</button><button class="chip-btn muted" type="button" data-listedel-annuler>Annuler</button></div></div>` : ""}
      </li>`).join("");
  }

  function render() {
    const pm = prodMap();

    // LISTE (la liste choisie)
    renderListes();
    const lid = idListeActive();
    $("#in-liste").placeholder = `Ajouter à « ${state.listes.length ? nomListe(lid) : "la liste"} »`;
    const liste = state.liste.filter((i) => i.liste_id === lid || (!i.liste_id && lid === (listesTriees()[0] || {}).id)).sort((a, b) => (a.fait - b.fait) || (a.cree < b.cree ? -1 : 1));
    const restants = liste.filter((i) => !i.fait);
    const lidsLieu = new Set(listesTriees().map((l) => l.id));
    $("#c-liste").textContent = state.liste.filter((i) => !i.fait && lidsLieu.has(i.liste_id)).length;
    if (!liste.length) {
      $("#list-liste").innerHTML = emptyBox(`« ${esc(nomListe(lid))} » est vide`, "Ajoutez un article ci-dessus. Les autres le verront aussitôt.");
      $("#liste-actions").hidden = true;
    } else {
      const saleNames = new Set(state.spec.filter((s) => !s.ignore).map((s) => norm(s.item)));
      $("#list-liste").innerHTML = `<ul class="list">${liste.map((i) => {
        const by = nameOf(i.par); const p = pm.get(norm(i.nom)); const b = p && bestOf(p);
        const onSale = saleNames.has(norm(i.nom)) || (b && b.special);
        const ph = photoOf(i, pm);
        if (i.id === editListe && brouillonListe) {
          const d = brouillonListe, autres = listesTriees();
          return `<li class="edit-item"><form class="f-edit-liste" data-id="${i.id}">
            <label class="mf" for="el-nom">Article</label>
            <input id="el-nom" data-el="nom" value="${esc(d.nom)}" required maxlength="80" autocomplete="off">
            <div class="el-ligne">
              <div><label class="mf" for="el-qte">Quantité</label><input id="el-qte" data-el="qte" value="${esc(d.qte)}" maxlength="20" placeholder="ex. 2, 1 kg" autocomplete="off"></div>
              ${autres.length > 1 ? `<div><label class="mf" for="el-liste">Liste</label><select id="el-liste" data-el="liste_id">${autres.map((l) => `<option value="${l.id}" ${l.id === d.liste_id ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}</select></div>` : ""}
            </div>
            <div class="row-actions"><button class="btn" type="submit">Enregistrer</button><button class="link muted" type="button" data-el-annuler>Annuler</button></div>
          </form></li>`;
        }
        return `<li class="${i.fait ? "done" : ""}">
          <input type="checkbox" class="check" id="chk-${i.id}" data-id="${i.id}" ${i.fait ? "checked" : ""} aria-label="Acheté : ${esc(i.nom)}">
          ${thumb(ph, i.nom)}
          <div class="main editable" data-editliste="${i.id}" role="button" tabindex="0" aria-label="Corriger ${esc(i.nom)}"><div class="name">${esc(i.nom)}${i.qte ? ` <span class="meta">× ${esc(i.qte)}</span>` : ""}${onSale ? '<span class="sale">en spécial</span>' : ""}</div>
          <div class="meta">${b ? `Meilleur prix : <span class="mono">${money(b.val)}</span> chez ${esc(b.store)}` : ""}${b && by ? " · " : ""}${by ? `ajouté par ${esc(by)}` : ""}</div></div>
          <button class="icon" data-del="epicerie" data-id="${i.id}" aria-label="Supprimer ${esc(i.nom)}">✕</button></li>`;
      }).join("")}</ul>`;
      const faits = liste.length - restants.length;
      $("#liste-actions").hidden = faits === 0;
      $("#liste-hint").textContent = faits ? `${faits} article${faits > 1 ? "s" : ""} coché${faits > 1 ? "s" : ""}` : "";
    }
    renderCompare(restants, pm);

    $("#stores").innerHTML = stores().map((m, ix) => `<span class="chip">${esc(m)}<button type="button" data-store="${ix}" aria-label="Retirer ${esc(m)}">✕</button></span>`).join("");

    // SPÉCIAUX
    const magsLieu = new Set(stores().map(norm)), pmSp = prodMap();
    const spec = state.spec.filter((s) => !s.ignore && magsLieu.has(norm(s.magasin)) && (() => { const p = pmSp.get(norm(s.item)); return !p || dansLieu(p); })())
      .sort((a, b) => norm(a.item).localeCompare(norm(b.item)) || (num(a.prix) || 0) - (num(b.prix) || 0));
    $("#c-speciaux").textContent = spec.length;
    $("#c-speciaux").classList.toggle("hot", spec.length > 0);
    const c = state.config;
    // Comment ça marche : ce que Rosalie surveille, son jeudi, et où en est la dernière vérification
    const surv = surveilles(), mags = stores();
    const jeudi = (() => { const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || (d.getHours() >= 8 ? 7 : 0))); return d.toISOString().slice(0, 10); })();
    $("#agent-info").innerHTML = `
      <div class="surv-titre">Ce que Rosalie surveille <span class="meta">${surv.length} produit${surv.length > 1 ? "s" : ""} ★</span></div>
      ${surv.length ? `<div class="surv-puces">${surv.map((p) => `<button class="fchip" type="button" data-survopen="${p.id}">★ ${esc(p.nom)}${p.prix_cible != null ? ` <span class="meta">sous ${money(num(p.prix_cible))}</span>` : ""}</button>`).join("")}</div>`
        : `<p class="hint">Rien pour l'instant. Dans l'onglet Produits, touchez l'étoile ☆ d'un produit que vous achetez souvent : je guetterai ses rabais.</p>`}
      <button class="link" type="button" data-survajout>${surv.length ? "Changer ce que je surveille" : "Choisir des produits à surveiller"}</button>
      <ol class="surv-etapes">
        <li><b>Chaque jeudi matin,</b> je lis les circulaires de ${mags.length ? esc(mags.join(", ")) : "vos épiceries (ajoutez celles de ce lieu plus bas)"}.</li>
        <li><b>Je mets à jour vos prix :</b> jusqu'à 30 produits par semaine. Vos produits ★ d'abord, puis ceux de la liste, puis ceux dont le prix est le plus ancien.</li>
        <li><b>Je vous montre ici</b> les rabais sur vos produits ★${surv.some((p) => p.prix_cible != null) ? ", sous votre prix cible quand vous en avez mis un" : ""}.</li>
      </ol>
      <p class="surv-etat">${c && c.derniere_verif ? `Dernière vérification : <b>${fmtDate(c.derniere_verif)}</b>${c.semaine ? ` (circulaires ${esc(c.semaine)})` : ""}.${c.resume ? ` ${esc(c.resume.split(".")[0])}.` : ""}` : "Première vérification à venir."} Prochaine : <b>jeudi ${fmtDate(jeudi)}</b>, en matinée.</p>
      <p class="hint">Vos prix changent aussi quand vous approuvez une facture (onglet Produits) ou quand vous les tapez dans la fiche d'un produit.</p>`;
    $("#list-spec").innerHTML = spec.length ? `${spec.length > 1 ? `<div class="sp-tous"><button class="btn" type="button" data-spshare="tous">📤 Partager les ${spec.length} spéciaux de la semaine</button><span class="hint">Vos proches profitent des rabais, et reçoivent 60 jours gratuits avec votre lien.</span></div>` : ""}<div class="deals">${spec.map((s) => {
      const inList = state.liste.some((i) => !i.fait && norm(i.nom) === norm(s.item));
      const pr = num(s.prix), rg = num(s.prix_reg);
      return `<div class="deal">
        <div><div class="store">${esc(s.magasin)}${s.fin ? ` · jusqu'au ${fmtDate(s.fin)}` : ""}</div><div class="name">${esc(s.item)}</div></div>
        <div><div class="price">${pr != null ? money(pr) : ""}</div>${rg != null ? `<div class="reg">${money(rg)}</div>` : ""}</div>
        ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ""}
        <div class="deal-actions">
          ${inList ? '<span class="meta">Déjà dans la liste</span>' : `<button class="link" data-addfrom="${s.id}" type="button">Ajouter à la liste</button>`}
          <button class="link" data-spshare="${s.id}" type="button">📤 Partager</button>
          <button class="link muted" data-ignore="${s.id}" type="button">Masquer</button>
          ${/^https?:\/\//.test(s.lien || "") ? `<a href="${esc(s.lien)}" target="_blank" rel="noopener">Voir la circulaire</a>` : ""}
        </div></div>`;
    }).join("")}</div>`
      : emptyBox("Aucun spécial trouvé pour l'instant", surveilles().length ? `Aucun de vos ${surveilles().length} produits surveillés n'est en rabais dans les circulaires vérifiées.` : "Touchez l'étoile ★ d'un produit dans l'onglet Produits pour surveiller ses spéciaux.");

    renderLieuGlobal();
    renderEco();
    renderProducts();
    renderMaison();
    if (state.userId) renderDemarrer();
    ensureUrls([...state.liste.map((i) => photoOf(i, pm)), ...state.prod.map((p) => p.photo)]);
  }

  function renderCompare(restants, pm) {
    const box = $("#compare");
    if (!restants.length) { box.innerHTML = ""; return; }
    const qty = (i) => { const q = num(i.qte); return q && q > 0 ? q : 1; };
    const rows = stores().map((s) => {
      let total = 0, miss = 0;
      restants.forEach((i) => { const p = pm.get(norm(i.nom)); const pr = p && priceAt(p, s); if (pr) total += pr.val * qty(i); else miss++; });
      return { s, total, miss, found: restants.length - miss };
    });
    const priced = rows.filter((r) => r.found > 0);
    if (!priced.length) {
      box.innerHTML = `<div class="compare"><h2>Où acheter cette semaine</h2><p class="hint">Aucun prix connu pour les articles de la liste. L'agent ajoute les prix chaque jeudi; vous pouvez aussi les inscrire dans l'onglet Produits.</p></div>`;
      return;
    }
    const maxFound = Math.max(...priced.map((r) => r.found));
    const bestTotal = Math.min(...priced.filter((r) => r.found === maxFound).map((r) => r.total));
    const maxTotal = Math.max(...priced.map((r) => r.total)) || 1;
    let mix = 0, mixMiss = 0; const perStore = {};
    restants.forEach((i) => { const p = pm.get(norm(i.nom)); const b = p && bestOf(p); if (b) { mix += b.val * qty(i); perStore[b.store] = (perStore[b.store] || 0) + 1; } else mixMiss++; });
    const sorted = [...rows].sort((a, b) => (b.found - a.found) || (a.total - b.total));
    box.innerHTML = `<div class="compare">
      <div class="compare-head"><h2>Où acheter cette semaine</h2><span class="hint">${restants.length} article${restants.length > 1 ? "s" : ""} à acheter</span></div>
      <div class="bars">${sorted.map((r) => {
        const isBest = r.found === maxFound && r.total === bestTotal;
        return `<div class="bar${isBest ? " best" : ""}"><span class="store-name">${esc(r.s)}</span>
          <span class="track"><span class="fill" style="display:block;width:${r.found ? Math.max(4, Math.round(r.total / maxTotal * 100)) : 0}%"></span></span>
          <span class="amt">${r.found ? money(r.total) : "—"}${r.miss ? `<br><span class="miss">${r.miss} sans prix</span>` : ""}</span></div>`;
      }).join("")}</div>
      ${Object.keys(perStore).length > 1 ? `<div class="mix">En achetant chaque article là où il est le moins cher : <b class="mono">${money(mix)}</b> (${Object.entries(perStore).map(([s, n]) => `${n} chez ${esc(s)}`).join(", ")})${mixMiss ? `, ${mixMiss} sans prix` : ""}.</div>` : ""}
      <p class="hint">Totaux estimés avec les prix connus (spécial en cours, sinon prix régulier) et la quantité inscrite.</p>
    </div>`;
  }

  function renderProducts() {
    const ici = prodLieu();
    $("#c-produits").textContent = ici.length;
    const q = norm(search);
    const nSurv = ici.filter((p) => p.surveiller).length, nMaison = ici.filter((p) => Number(p.stock || 0) > 0).length;
    $("#n-surv").textContent = nSurv; $("#n-maison").textContent = nMaison; $("#f-lieu-nom").textContent = state.lieux.length > 1 ? nomLieu() : "En réserve";
    document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filtre)));
    const list = ici.filter((p) => (!q || norm([p.nom, p.marque, p.format, p.categorie].join(" ")).includes(q))
      && (filtre === "tous" || (filtre === "surv" && p.surveiller) || (filtre === "maison" && Number(p.stock || 0) > 0)));
    const ailleurs = q ? state.prod.filter((p) => !dansLieu(p) && norm([p.nom, p.marque, p.format].join(" ")).includes(q)) : [];
    const blocAilleurs = ailleurs.length ? `<div class="ailleurs"><p class="hint">Dans un autre lieu :</p>${ailleurs.slice(0, 8).map((p) => `<button class="fchip" type="button" data-lieuajout="${p.id}">＋ ${esc(p.nom)} <span class="meta">${esc((p.lieux || []).map((x) => nomLieu(x)).join(", "))}</span></button>`).join("")}</div>` : "";
    if (!ici.length && !ailleurs.length) { $("#list-prod").innerHTML = emptyBox(state.lieux.length > 1 ? `Aucun produit à « ${esc(nomLieu())} » pour l'instant` : "Aucun produit pour l'instant", "Ajoutez vos produits habituels ci-dessus, ou ajoutez simplement des articles à la liste : ils s'inscriront ici."); return; }
    if (!list.length) { $("#list-prod").innerHTML = filtre === "surv" && !q ? emptyBox("Aucun produit surveillé", "Touchez l'étoile ☆ à droite d'un produit pour que Rosalie guette ses rabais chaque jeudi.")
      : filtre === "maison" && !q ? emptyBox("Rien à la maison", "Les produits rangés dans un espace avec une réserve apparaîtront ici.")
      : emptyBox("Aucun produit trouvé", `Rien ne correspond à « ${esc(search)} »${state.lieux.length > 1 ? ` à « ${esc(nomLieu())} »` : ""}.`) + blocAilleurs; return; }
    // Don't rebuild while someone types in a product's fields.
    const act = document.activeElement;
    if (act && act.closest && act.closest("#list-prod [data-stop]")) return;
    const groups = {};
    list.forEach((p) => { const c = p.categorie || "Autre"; (groups[c] = groups[c] || []).push(p); });
    const order = [...CATS, ...Object.keys(groups).filter((c) => !CATS.includes(c))];
    $("#list-prod").innerHTML = `<ul class="list">${order.filter((c) => groups[c]).map((c) =>
      `<li class="cat-head" style="display:block">${esc(c)}</li>` +
      groups[c].sort((a, b) => norm(a.nom).localeCompare(norm(b.nom))).map((p) => {
        const b = bestOf(p);
        return `<li class="prod-row" data-prod="${p.id}">
          ${thumb(p.photo, p.nom)}
          <div class="main"><div class="name">${esc(p.nom)}${b && b.special ? '<span class="sale">spécial</span>' : ""}</div>
          <div class="meta">${esc([p.marque, p.format, reservesAilleurs(p), p.surveiller && p.prix_cible != null ? "cible " + money(Number(p.prix_cible)) : ""].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
          <div class="best-price">${b ? money(b.val) + `<small>${esc(b.store)}</small>` : "<small>aucun prix</small>"}</div>
          ${(() => { const dl = dansListeLieu(p); return `<button class="cart${dl ? " on" : ""}" type="button" data-tolist="${p.id}" aria-pressed="${dl ? "true" : "false"}" aria-label="${dl ? `Retirer ${esc(p.nom)} de « ${esc(nomListe(dl.liste_id))} »` : `Ajouter ${esc(p.nom)} à la liste d'épicerie`}" title="${dl ? `Dans « ${esc(nomListe(dl.liste_id))} » · toucher pour retirer` : "Ajouter à la liste d'épicerie"}">${dl ? "✓" : "🛒"}</button>`; })()}
          <button class="star${p.surveiller ? " on" : ""}" type="button" data-survtoggle="${p.id}" aria-pressed="${p.surveiller ? "true" : "false"}" aria-label="${p.surveiller ? "Ne plus surveiller" : "Surveiller les spéciaux de"} ${esc(p.nom)}">${p.surveiller ? "★" : "☆"}</button>
          ${openProd === p.id ? productDetail(p, b) : ""}
        </li>`;
      }).join("")).join("")}</ul>${blocAilleurs}`;
  }

  // ---------- maison : espaces et réserves
  // ---------- plusieurs lieux (Maison, Chalet…) : chaque lieu a ses espaces et ses réserves
  let lieuActif = null;
  try { lieuActif = localStorage.getItem("lieu-actif"); } catch (e) {}
  const lieuxTries = () => [...state.lieux].sort((a, b) => (a.ordre - b.ordre) || String(a.cree).localeCompare(String(b.cree)));
  const idLieu = () => { const l = state.lieux.find((x) => x.id === lieuActif) || lieuxTries()[0]; return l ? l.id : null; };
  const nomLieu = (id) => (state.lieux.find((x) => x.id === (id || idLieu())) || {}).nom || "Maison";
  // Les champs de réserve du lieu ouvert sont posés sur chaque produit (p.stock, p.espace_id, p.minimum, p.peremption)
  function appliquerLieu() {
    const lid = idLieu(), par = new Map(state.inv.filter((r) => r.lieu_id === lid).map((r) => [r.produit_id, r]));
    state.prod.forEach((p) => { const r = par.get(p.id); p.stock = r ? Number(r.stock || 0) : 0; p.espace_id = r ? r.espace_id : null; p.minimum = r ? r.minimum : null; p.peremption = r ? r.peremption : null; });
  }
  async function majInv(pid, champs) {
    const lid = idLieu(); if (!lid) return false;
    const pp = state.prod.find((x) => x.id === pid); if (pp && !dansLieu(pp, lid)) ajouterAuLieu(pp, lid);
    let r = state.inv.find((x) => x.produit_id === pid && x.lieu_id === lid);
    if (!r) { r = { produit_id: pid, lieu_id: lid, stock: 0, espace_id: null, minimum: null, peremption: null }; state.inv.push(r); }
    Object.assign(r, champs);
    const { error } = await sb.from("inventaire").upsert({ produit_id: pid, lieu_id: lid, ...champs, maj: new Date().toISOString() }, { onConflict: "produit_id,lieu_id" });
    if (error) { status("La modification n'a pas été enregistrée. Vérifiez votre connexion et réessayez."); console.error(error); scheduleReload("inventaire"); return false; }
    return true;
  }
  const reservesAilleurs = (p) => state.lieux.length > 1
    ? state.inv.filter((r) => r.produit_id === p.id && Number(r.stock || 0) > 0).map((r) => `${fmtQ(r.stock)} ${nomLieu(r.lieu_id)}`).join(" · ")
    : (Number(p.stock || 0) > 0 ? fmtQ(p.stock) + " à la maison" : "");
  let lieuEnEdition = false, lieuASupprimer = null;
  function choisirLieu(id) { lieuActif = id; try { localStorage.setItem("lieu-actif", id); } catch (e) {} appliquerLieu(); render(); assurerListeLieu(); }
  let creationListe = false;
  async function assurerListeLieu() {
    const lid = idLieu(); if (!lid || creationListe || !state.userId || listesTriees().length) return;
    creationListe = true;
    const { data } = await sb.from("listes").insert({ nom: "Épicerie", ordre: 1, lieu_id: lid }).select("*").single();
    creationListe = false; if (data) { state.listes.push(data); render(); }
  }
  // Sélecteur de lieu visible dans tous les onglets : Produits, Liste et Spéciaux suivent le lieu ouvert
  function renderLieuGlobal() {
    const box = $("#lieu-global"); if (!box) return;
    const ls = lieuxTries(), act = idLieu();
    if (!ls.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `<span class="lg-titre" aria-hidden="true">📍</span>${ls.map((l) => `<button class="fchip" type="button" data-lieu="${l.id}" aria-pressed="${ls.length > 1 && l.id === act}">${esc(l.nom)}</button>`).join("")}<button class="fchip lg-ajout" type="button" data-lieu-new aria-label="Ajouter un lieu" aria-pressed="${lieuEnEdition}">＋ Lieu</button>`;
    const t = $("#stores-titre"); if (t) t.textContent = `Épiceries à vérifier à « ${nomLieu()} »`;
  }
  $("#lieu-global").addEventListener("click", (e) => {
    const c = e.target.closest("[data-lieu]"); if (c) return choisirLieu(c.dataset.lieu);
    if (e.target.closest("[data-lieu-new]")) {
      lieuEnEdition = !lieuEnEdition;
      if (lieuEnEdition) showView("maison");
      render();
      if (lieuEnEdition) setTimeout(() => { const i = $("#in-nouveau-lieu"); i.focus(); i.scrollIntoView({ block: "center", behavior: "smooth" }); }, 50);
    }
  });
  function renderLieux() {
    const act = idLieu(), ls = lieuxTries();
    $("#tab-lieu-nom").textContent = "Espace";
    $("#lieux-bar").innerHTML = ""; $("#lieux-bar").hidden = true; // le choix du lieu et « ＋ Lieu » sont dans la barre 📍 en haut
    $("#f-nouveau-lieu").hidden = !lieuEnEdition;
    const a2 = document.activeElement;
    if (a2 && a2.closest && a2.closest("#list-lieux")) return;
    $("#list-lieux").innerHTML = ls.map((l, i) => `<li>
        <input id="lieu-${l.id}" value="${esc(l.nom)}" aria-label="Nom du lieu" data-lieunom="${l.id}">
        <button class="icon" type="button" data-lieumove="-1" data-id="${l.id}" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="icon" type="button" data-lieumove="1" data-id="${l.id}" aria-label="Descendre" ${i === ls.length - 1 ? "disabled" : ""}>↓</button>
        ${ls.length > 1 ? `<button class="icon" type="button" data-lieudel="${l.id}" aria-label="Supprimer ${esc(l.nom)}">✕</button>` : ""}
        ${lieuASupprimer === l.id ? `<div class="move-row del-row"><span class="hint">Supprimer « ${esc(l.nom)} », ses espaces et ses réserves ? Les produits restent dans l'onglet Produits.</span>
          <div class="move-choices"><button class="chip-btn danger" type="button" data-lieudel-ok="${l.id}">Supprimer</button><button class="chip-btn muted" type="button" data-lieudel-annuler>Annuler</button></div></div>` : ""}
      </li>`).join("");
  }
  const espacesTries = () => [...state.espaces].filter((e) => !e.lieu_id || e.lieu_id === idLieu()).sort((a, b) => (a.ordre - b.ordre) || norm(a.nom).localeCompare(norm(b.nom)));
  const estBas = (p) => p.minimum != null && Number(p.stock || 0) <= Number(p.minimum);
  const fmtQ = (n) => { const v = Math.round(Number(n || 0) * 100) / 100; return Number.isInteger(v) ? String(v) : String(v).replace(".", ","); };
  const espaceSelect = (p, id) => `<select id="${id}" aria-label="Espace" data-pfield="espace_id" data-id="${p.id}">
      <option value="">Sans espace</option>${espacesTries().map((e) => `<option value="${e.id}" ${e.id === p.espace_id ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select>`;
  function stockCtl(p) {
    return `<div class="stock${estBas(p) ? " low" : ""}">
      <button class="sbtn" type="button" data-stock="-1" data-id="${p.id}" aria-label="Retirer un ${esc(p.nom)}">−</button>
      <span class="sval" aria-label="En réserve">${fmtQ(p.stock)}</span>
      <button class="sbtn" type="button" data-stock="1" data-id="${p.id}" aria-label="Ajouter un ${esc(p.nom)}">+</button>
    </div>`;
  }
  let moveOpen = null, delOpen = null, dateOpen = null;
  const joursAvant = (d) => d ? Math.round((new Date(d + "T12:00:00") - new Date(today() + "T12:00:00")) / 864e5) : null;
  function expTag(p) {
    if (!p.peremption || !(Number(p.stock || 0) > 0)) return "";
    const j = joursAvant(p.peremption);
    const cls = j < 0 ? "exp gone" : j <= 3 ? "exp soon" : "exp";
    const txt = j < 0 ? `périmé depuis le ${fmtDate(p.peremption)}` : j === 0 ? "expire aujourd'hui" : j === 1 ? "expire demain" : `exp. ${fmtDate(p.peremption)}`;
    return `<span class="${cls}">${txt}</span>`;
  }
  const bientot = () => state.prod.filter((p) => p.peremption && Number(p.stock || 0) > 0 && joursAvant(p.peremption) <= 3)
    .sort((a, b) => a.peremption.localeCompare(b.peremption));

  // ---------- panier (facture à approuver)
  function renderPanier() {
    const box = $("#panier");
    const rows = [...state.panier].sort((a, b) => (a.cree < b.cree ? -1 : 1));
    if (!rows.length) { box.innerHTML = ""; return; }
    const act = document.activeElement;
    if (act && act.closest && act.closest("#panier [data-panier-id]")) return;
    const lots = [...new Set(rows.map((r) => `${r.magasin || "Épicerie"} · ${fmtDate(r.date_achat)}`))];
    const esp = espacesTries();
    box.innerHTML = `<div class="panier">
      <div class="compare-head"><h2>Panier à approuver <span class="count hot">${rows.length}</span></h2><span class="hint">${esc(lots.join(" ; "))}</span></div>
      <p class="hint">Vérifiez chaque article, corrigez au besoin, puis approuvez-le : il sera rangé dans son espace et coché dans la liste.</p>
      <ul class="list">${rows.map((r) => {
        const connu = r.produit_id && state.prod.find((p) => p.id === r.produit_id);
        return `<li class="panier-item" data-panier-id="${r.id}">
          <div class="pi-head"><input class="pi-nom" value="${esc(r.nom)}" aria-label="Nom" data-pan="nom" data-id="${r.id}">
            <span class="price">${r.prix_total != null ? money(Number(r.prix_total)) : ""}</span></div>
          <div class="meta">Facture : « ${esc(r.texte || "")} »${connu ? " · produit connu" : " · nouveau produit"}${r.confiance === "basse" ? ' · <b class="exp soon">à vérifier</b>' : ""}</div>
          <div class="pi-fields">
            <label class="mf">Quantité <input inputmode="decimal" value="${esc(fmtQ(r.quantite || 1))}" data-pan="quantite" data-id="${r.id}"></label>
            <label class="mf">Espace <select data-pan="espace_id" data-id="${r.id}"><option value="">Sans espace</option>${esp.map((e) => `<option value="${e.id}" ${e.id === r.espace_id ? "selected" : ""}>${esc(e.nom)}</option>`).join("")}</select></label>
            <label class="mf">Péremption <input type="date" value="${esc(r.peremption || "")}" data-pan="peremption" data-id="${r.id}"></label>
          </div>
          <div class="row-actions"><button class="btn" type="button" data-approuver="${r.id}">Approuver</button>
            <button class="link muted" type="button" data-ignorer="${r.id}">Ignorer</button></div>
        </li>`;
      }).join("")}</ul>
      <div class="row-actions"><button class="link" type="button" id="panier-tout">Tout approuver (${rows.length})</button>
        <button class="link muted" type="button" id="panier-vider">Tout ignorer</button></div>
    </div>`;
  }
  // ---------- économies réalisées : notées quand on approuve une facture
  const round2 = (x) => Math.round(x * 100) / 100;
  // Prix de référence : le prix régulier d'un spécial en cours sur ce produit, sinon le prix habituel déjà connu dans ce magasin.
  function economieDe(p, pu, magasin, date) {
    if (!p || !(pu > 0)) return null;
    const sp = state.spec.find((s) => !s.ignore && norm(s.item) === norm(p.nom) && num(s.prix_reg) > 0
      && (!magasin || !s.magasin || norm(s.magasin) === norm(magasin))
      && (!s.debut || s.debut <= date) && (!s.fin || s.fin >= date));
    let ref = null, source = null;
    if (sp && pu < num(sp.prix_reg)) { ref = num(sp.prix_reg); source = "special"; }
    else {
      const e = magasin && p.prix && p.prix[magasin], reg = e && num(e.reg);
      if (reg && pu < reg) { ref = reg; source = "habituel"; }
    }
    // Écart trop petit, ou trop grand pour être vrai (facture mal lue) : on ne compte rien
    if (!ref || ref - pu < 0.05 || pu < ref * 0.25) return null;
    return { ref: round2(ref), source };
  }
  function renderEco() {
    const box = $("#economies"); if (!box) return;
    const an = String(new Date().getFullYear()), mois = today().slice(0, 7);
    const somme = (l) => l.reduce((t, e) => t + (num(e.montant) || 0), 0);
    const annee = state.eco.filter((e) => String(e.date_achat || "").startsWith(an));
    const ceMois = annee.filter((e) => String(e.date_achat || "").startsWith(mois));
    if (!state.eco.length) {
      box.innerHTML = `<div class="eco vide"><div class="eco-titre">Économies réalisées</div>
        <p class="hint">Lisez vos factures dans l'onglet Produits : chaque article payé sous son prix régulier est noté ici, avec ce que vous avez économisé.</p></div>`;
      return;
    }
    const recentes = [...state.eco].sort((a, b) => String(b.date_achat).localeCompare(String(a.date_achat)) || String(b.cree || "").localeCompare(String(a.cree || ""))).slice(0, 5);
    box.innerHTML = `<div class="eco">
      <div class="eco-titre">Économies réalisées</div>
      <div class="eco-chiffres">
        <div><span class="eco-val">${money(somme(ceMois))}</span><span class="eco-lbl">ce mois-ci</span></div>
        <div><span class="eco-val">${money(somme(annee))}</span><span class="eco-lbl">en ${an}</span></div>
        <div><span class="eco-val">${annee.length}</span><span class="eco-lbl">article${annee.length > 1 ? "s" : ""} sous le prix</span></div>
      </div>
      <details><summary>Derniers achats</summary><ul class="eco-liste">${recentes.map((e) => `<li>
        <span>${esc(e.nom)}${e.magasin ? ` <span class="meta">· ${esc(e.magasin)}</span>` : ""}<br><span class="meta">${e.source === "special" ? "en spécial" : "sous le prix habituel"} · payé ${money(num(e.prix_paye))} au lieu de ${money(num(e.prix_ref))}${num(e.quantite) > 1 ? ` × ${fmtQ(e.quantite)}` : ""}</span></span>
        <span class="eco-plus">−${money(num(e.montant))}</span></li>`).join("")}</ul>
        <p class="hint">Calcul : prix régulier du spécial, ou prix habituel connu dans ce magasin, moins le prix payé sur la facture.</p></details>

    </div>`;
  }

  async function approuver(r) {
    const nom = (r.nom || "").trim(); if (!nom) { status("Donnez un nom à l'article avant de l'approuver."); return false; }
    const qte = Number(r.quantite) > 0 ? Number(r.quantite) : 1;
    let p = (r.produit_id && state.prod.find((x) => x.id === r.produit_id)) || state.prod.find((x) => norm(x.nom) === norm(nom));
    if (!p) {
      const row = { nom, marque: r.marque || "", format: r.format || "", categorie: r.categorie || "Autre", lieux: [idLieu()].filter(Boolean) };
      const { data, error } = await sb.from("produits").insert(row).select("*").single();
      if (error) { status("L'article n'a pas pu être ajouté. Réessayez."); console.error(error); return false; }
      p = data; p.stock = 0; p.espace_id = null; p.minimum = null; p.peremption = null; state.prod.push(p);
    }
    const avant = Number(p.stock || 0);
    const per = r.peremption || null;
    const peremption = per && avant > 0 && p.peremption && p.peremption < per ? p.peremption : (per || (avant > 0 ? p.peremption : null));
    const maj = { stock: avant + qte, peremption };
    if (r.espace_id) maj.espace_id = r.espace_id;
    if (!(await majInv(p.id, maj))) return false;
    Object.assign(p, maj);
    const pu = Number(r.prix_unitaire) > 0 ? Number(r.prix_unitaire) : (Number(r.prix_total) > 0 ? Number(r.prix_total) / qte : null);
    const eco = economieDe(p, pu, r.magasin, r.date_achat || today());
    if (eco) {
      const ligne = { produit_id: p.id, nom: p.nom, magasin: r.magasin || null, date_achat: r.date_achat || today(), quantite: qte,
        prix_paye: round2(pu), prix_ref: eco.ref, montant: round2((eco.ref - pu) * qte), source: eco.source };
      const { error } = await sb.from("economies").insert(ligne);
      if (error) console.error(error); else state.eco.push(ligne);
    }
    // Acheté en spécial : on garde le prix régulier connu (le prix habituel ne doit pas devenir le prix du spécial)
    if (pu && r.magasin && stores().includes(r.magasin) && !(eco && eco.source === "special")) {
      await sb.rpc("maj_prix", { p_id: p.id, p_magasin: r.magasin, p_entree: { reg: Math.round(pu * 100) / 100, maj: r.date_achat || today(), par: "facture" } });
    }
    const it = state.liste.find((i) => !i.fait && norm(i.nom) === norm(p.nom));
    if (it) { it.fait = true; await sb.from("epicerie").update({ fait: true }).eq("id", it.id); }
    await sb.from("panier").delete().eq("id", r.id);
    state.panier = state.panier.filter((x) => x.id !== r.id);
    return true;
  }
  const lirePanierRow = (id) => {
    const r = { ...(state.panier.find((x) => x.id === id) || {}) };
    document.querySelectorAll(`#panier [data-id="${id}"][data-pan]`).forEach((el) => {
      const f = el.dataset.pan, v = el.value.trim();
      r[f] = f === "quantite" ? (num(v) || 1) : (v || null);
    });
    return r;
  };

  // Lecture d'une facture
  $("#in-facture").addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])].slice(0, 4); e.target.value = "";
    if (!files.length) return;
    status(`Lecture de la facture… (${files.length} photo${files.length > 1 ? "s" : ""}, environ 30 secondes)`);
    $("#lbl-facture").classList.add("busy");
    try {
      const imgs = await Promise.all(files.map((f) => shrink(f, 1800)));
      const paths = await Promise.all(imgs.map((i) => uploadPhoto(i.blob, "factures")));
      const { data, error } = await sb.functions.invoke("lire-facture", { body: { images: imgs.map((i) => i.b64), lieu_id: idLieu() } });
      if (error || !data || data.erreur) throw new Error((data && data.erreur) || "lecture");
      const arts = data.articles || [];
      if (!arts.length) { status("Aucun article n'a pu être lu sur cette photo. Reprenez-la bien à plat, avec un bon éclairage."); return; }
      const lot = crypto.randomUUID();
      const rows = arts.map((a) => ({ lot, magasin: data.magasin || "", date_achat: data.date || today(), texte: a.texte, produit_id: a.produit_id, nom: a.nom,
        marque: a.marque, format: a.format, categorie: a.categorie, quantite: a.quantite, prix_unitaire: a.prix_unitaire, prix_total: a.prix_total,
        espace_id: a.espace_id, peremption: a.peremption, confiance: a.confiance, photo: paths[0] }));
      if (await run(sb.from("panier").insert(rows), `${rows.length} article${rows.length > 1 ? "s" : ""} lu${rows.length > 1 ? "s" : ""} sur la facture${data.magasin ? " de " + data.magasin : ""}. Approuvez-les ci-dessous.`)) {
        await load("panier"); showView("produits"); render();
        $("#panier").scrollIntoView({ block: "start", behavior: "smooth" });
      }
    } catch (err) {
      console.error(err);
      status("La facture n'a pas pu être lue. Vérifiez votre connexion et réessayez, ou prenez une photo plus nette.");
    } finally { $("#lbl-facture").classList.remove("busy"); }
  });
  // ---------- bilan du soir (consommation)
  let bilanOuvert = false; const conso = {}; // id -> quantité consommée
  const consoUnite = {}, consoSaisie = {}; // id -> "u" | "pct" | "poids"; ce qui a été tapé
  // Taille d'un emballage d'après le format (« 500 g », « 1,89 L », « 12 x 355 ml », « 2 lb ») : { qte, base: "g" | "ml" }
  function tailleFormat(f) {
    const t = norm(String(f || "")).replace(",", ".");
    const m = t.match(/(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|mg|g|lbs?|oz|ml|cl|l)\b/);
    if (!m) return null;
    const mult = m[1] ? Number(m[1]) : 1, n = Number(m[2]) * mult, u = m[3];
    const conv = { kg: [1000, "g"], g: [1, "g"], mg: [0.001, "g"], lb: [453.6, "g"], lbs: [453.6, "g"], oz: [28.35, "g"], l: [1000, "ml"], cl: [10, "ml"], ml: [1, "ml"] }[u];
    return n > 0 ? { qte: n * conv[0], base: conv[1] } : null;
  }
  // Convertit une saisie (« 300 », « 300 g », « 0,3 kg », « 30 % », « 1,5 ») en emballages consommés
  function saisieEnUnites(p, brut, unite) {
    const t = String(brut || "").trim().toLowerCase().replace(",", ".");
    if (!t) return 0;
    const v = parseFloat(t); if (!isFinite(v) || v < 0) return null;
    const tf = tailleFormat(p.format);
    let u = unite || "u";
    if (/%/.test(t)) u = "pct";
    else if (/(kg|mg|g|lb|oz|ml|cl|l)\s*$/.test(t)) u = "poids";
    if (u === "pct") return v / 100;
    if (u === "poids") {
      if (!tf) return null;
      const m = t.match(/(kg|mg|g|lbs?|oz|ml|cl|l)\s*$/);
      const f = m ? ({ kg: 1000, g: 1, mg: 0.001, lb: 453.6, lbs: 453.6, oz: 28.35, l: 1000, cl: 10, ml: 1 }[m[1]]) : 1;
      return (v * f) / tf.qte;
    }
    return v;
  }
  function fmtConso(p, c) {
    const u = consoUnite[p.id], tf = tailleFormat(p.format);
    if (u === "pct") return `${fmtQ(c * 100)} %`;
    if (u === "poids" && tf) { const q = c * tf.qte; return q >= 1000 ? `${fmtQ(q / 1000)} ${tf.base === "g" ? "kg" : "L"}` : `${fmtQ(Math.round(q))} ${tf.base}`; }
    return fmtQ(c);
  }
  const ESP_ORDRE = (p) => { const e = state.espaces.find((x) => x.id === p.espace_id); return e ? e.ordre : 99; };
  function bilanDu() {
    const c = state.config || {}; const h = Number(c.bilan_heure ?? 21);
    const auj = today();
    return c.dernier_bilan !== auj && new Date().getHours() >= h;
  }
  function renderBilan() {
    const box = $("#bilan");
    const items = state.prod.filter((p) => Number(p.stock || 0) > 0)
      .sort((a, b) => (ESP_ORDRE(a) - ESP_ORDRE(b)) || ((a.peremption || "9") < (b.peremption || "9") ? -1 : 1) || norm(a.nom).localeCompare(norm(b.nom)));
    if (!bilanOuvert && !bilanDu()) {
      // Toujours un moyen d'y revenir, même avant 21 h ou après « Plus tard »
      const fait = (state.config || {}).dernier_bilan === today();
      box.innerHTML = items.length ? `<div class="bilan-lien"><button class="link" type="button" id="bilan-go">${fait ? "Bilan fait aujourd'hui · le corriger ou l'ajouter" : "Bilan de consommation · noter ce qui a été consommé"}</button></div>` : "";
      return;
    }
    if (!bilanOuvert) {
      box.innerHTML = `<div class="mix bilan-invite"><b>Bilan de la journée</b> : qu'est-ce qui a été consommé aujourd'hui ?
        <div class="row-actions"><button class="btn" type="button" id="bilan-go">Faire le bilan</button><button class="link muted" type="button" id="bilan-rien">Rien aujourd'hui</button></div></div>`;
      return;
    }
    const act = document.activeElement;
    if (act && act.closest && act.closest("#bilan input")) return;
    const nb = Object.values(conso).filter((v) => v > 0).length;
    let espCourant = null;
    box.innerHTML = `<div class="panier bilan">
      <div class="compare-head"><h2>Bilan de la journée</h2><span class="hint">${nb ? nb + " produit" + (nb > 1 ? "s" : "") + " consommé" + (nb > 1 ? "s" : "") : "Touchez ce qui a été consommé"}</span></div>
      <p class="hint">Pour chaque produit : −1 unité, −25 % ou −50 % d'un emballage, ou « Tout ». Ou inscrivez la quantité exacte et choisissez l'unité : en unités, en %, ou en poids (g, ml) quand le format du produit est connu (ex. « 500 g »).</p>
      ${items.length ? `<ul class="list">${items.map((p) => {
        const e = state.espaces.find((x) => x.id === p.espace_id);
        const head = (e ? e.nom : "Sans espace") !== espCourant ? (espCourant = e ? e.nom : "Sans espace", `<li class="cat-head" style="display:block">${esc(espCourant)}</li>`) : "";
        const c = conso[p.id] || 0, reste = Math.max(0, Number(p.stock) - c);
        return head + `<li class="bilan-item${c > 0 ? " touched" : ""}">
          ${thumb(p.photo, p.nom)}
          <div class="main"><div class="name">${esc(p.nom)}</div>
            <div class="meta">${c > 0 ? `<b>−${esc(fmtConso(p, c))}</b>${consoUnite[p.id] && consoUnite[p.id] !== "u" ? ` (${fmtQ(c)} emballage${c >= 2 ? "s" : ""})` : ""} · il restera ${fmtQ(reste)}` : `${fmtQ(p.stock)} ${state.lieux.length > 1 ? "au lieu « " + esc(nomLieu()) + " »" : "à la maison"}`}${expTag(p) ? " · " + expTag(p) : ""}</div></div>
          <div class="bilan-ctl">
            <button class="chip-btn" type="button" data-conso="1" data-id="${p.id}">−1</button>
            <button class="chip-btn" type="button" data-conso="0.25" data-id="${p.id}">−25 %</button>
            <button class="chip-btn" type="button" data-conso="0.5" data-id="${p.id}">−50 %</button>
            <button class="chip-btn" type="button" data-conso="tout" data-id="${p.id}">Tout</button>
            <span class="bilan-autre"><input class="bilan-in" inputmode="decimal" aria-label="Quantité consommée de ${esc(p.nom)}" placeholder="autre" value="${esc(consoSaisie[p.id] != null && c > 0 ? consoSaisie[p.id] : c > 0 ? fmtQ(c) : "")}" data-consoin="${p.id}">
              <select class="bilan-unite" aria-label="Unité pour ${esc(p.nom)}" data-consounit="${p.id}">
                <option value="u"${(consoUnite[p.id] || "u") === "u" ? " selected" : ""}>unité${Number(p.stock) > 1 ? "s" : ""}</option>
                <option value="pct"${consoUnite[p.id] === "pct" ? " selected" : ""}>%</option>
                ${tailleFormat(p.format) ? `<option value="poids"${consoUnite[p.id] === "poids" ? " selected" : ""}>${tailleFormat(p.format).base}</option>` : ""}
              </select></span>
            ${c > 0 ? `<button class="icon" type="button" data-conso="0" data-id="${p.id}" aria-label="Annuler pour ${esc(p.nom)}">↺</button>` : ""}
          </div></li>`;
      }).join("")}</ul>` : emptyBox("Rien à la maison", "Ajoutez des produits à la Maison pour faire le bilan.")}
      <div class="row-actions"><button class="btn" type="button" id="bilan-ok">${nb ? "Enregistrer le bilan" : "Rien consommé aujourd'hui"}</button>
        <button class="link muted" type="button" id="bilan-fermer">Plus tard</button></div>
    </div>`;
  }
  function ouvrirBilan() { bilanOuvert = true; showView("maison"); render(); setTimeout(() => $("#bilan").scrollIntoView({ block: "start", behavior: "smooth" }), 50); }
  async function marquerBilanFait() {
    const auj = today();
    if (state.config) state.config.dernier_bilan = auj;
    await run(sb.from("config").update({ dernier_bilan: auj }).eq("foyer_id", state.foyer && state.foyer.id));
  }
  async function enregistrerBilan() {
    const ids = Object.keys(conso).filter((id) => conso[id] > 0);
    $("#bilan-ok").disabled = true;
    for (const id of ids) await ajusterStock(id, -conso[id]);
    ids.forEach((id) => { delete conso[id]; delete consoUnite[id]; delete consoSaisie[id]; });
    await marquerBilanFait();
    bilanOuvert = false; render();
    status(ids.length ? `Bilan enregistré : ${ids.length} produit${ids.length > 1 ? "s" : ""} mis à jour.` : "Bilan enregistré : rien consommé aujourd'hui.");
  }
  $("#bilan").addEventListener("click", async (e) => {
    if (e.target.closest("#bilan-go")) return ouvrirBilan();
    if (e.target.closest("#bilan-rien")) { await marquerBilanFait(); render(); status("Noté : rien consommé aujourd'hui."); return; }
    if (e.target.closest("#bilan-fermer")) { bilanOuvert = false; render(); status("D'accord. Vos choix sont gardés : le bilan reste en haut de l'onglet Espace pour continuer quand vous voulez."); return; }
    if (e.target.closest("#bilan-ok")) return enregistrerBilan();
    const b = e.target.closest("[data-conso]"); if (!b) return;
    const p = state.prod.find((x) => x.id === b.dataset.id); if (!p) return;
    const v = b.dataset.conso, stock = Number(p.stock || 0), avant = conso[p.id] || 0;
    conso[p.id] = v === "tout" ? stock : v === "0" ? 0 : Math.min(stock, Math.round((avant + Number(v)) * 100) / 100);
    delete consoSaisie[p.id]; if (v === "0") delete consoUnite[p.id];
    renderBilan();
  });
  $("#bilan").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-consounit]"), inp = e.target.closest("[data-consoin]");
    if (!sel && !inp) return;
    const id = sel ? sel.dataset.consounit : inp.dataset.consoin;
    const p = state.prod.find((x) => x.id === id); if (!p) return;
    const ligne = e.target.closest(".bilan-autre");
    const champ = ligne.querySelector("[data-consoin]"), choix = ligne.querySelector("[data-consounit]");
    let unite = choix.value; const brut = champ.value.trim();
    // Une unité tapée dans le champ (« 30 % », « 300 g ») choisit l'unité
    if (/%/.test(brut)) unite = "pct"; else if (/(kg|mg|g|lb|oz|ml|cl|l)\s*$/i.test(brut)) unite = "poids";
    const v = saisieEnUnites(p, brut, unite);
    if (v == null) { status(unite === "poids" && !tailleFormat(p.format) ? `Ajoutez le format de « ${p.nom} » (ex. 500 g) dans l'onglet Produits pour noter en poids.` : "Inscrivez un nombre, par exemple 1, 30 % ou 300 g."); return; }
    consoUnite[p.id] = unite;
    if (brut) consoSaisie[p.id] = brut.replace(/\s*(%|kg|mg|g|lbs?|oz|ml|cl|l)\s*$/i, ""); else delete consoSaisie[p.id];
    const stock = Number(p.stock || 0);
    if (v > stock + 1e-9) status(`Il n'y a que ${fmtQ(stock)} emballage${stock >= 2 ? "s" : ""} de « ${p.nom} » : j'ai noté le tout.`);
    conso[p.id] = Math.max(0, Math.min(stock, Math.round(v * 1000) / 1000));
    if (inp) inp.blur(); renderBilan();
  });
  $("#bilan-ouvrir").addEventListener("click", () => { $("#rappel").hidden = true; ouvrirBilan(); });
  window.addEventListener("hashchange", () => { if (location.hash === "#bilan" && state.email) ouvrirBilan(); });
  navigator.serviceWorker && navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener("message", (e) => { if (e.data === "bilan") ouvrirBilan(); });

  // ---------- notifications (rappel à 21 h)
  const urlB64 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  let rappelActif = false;
  function majCloche(actif) {
    rappelActif = actif;
    const b = $("#open-rappel");
    b.classList.toggle("on", actif); b.classList.toggle("off", !actif);
    b.querySelector(".bell-txt").textContent = actif ? "Rappel activé" : "Rappel pas activé";
    b.setAttribute("aria-label", actif ? "Rappel du bilan à 21 h : activé. Toucher pour les options." : "Rappel du bilan à 21 h : pas activé. Toucher pour l'activer.");
    b.title = actif ? "Rappel du bilan activé (21 h)" : "Toucher pour activer le rappel du bilan (21 h)";
    if (typeof renderDemarrer === "function" && state.userId) renderDemarrer();
  }
  async function etatRappel() {
    const etat = $("#rappel-etat"); const on = $("#rappel-activer"), off = $("#rappel-desactiver");
    majCloche(false);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      etat.textContent = /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone
        ? "Sur iPhone, installez d'abord l'app sur l'écran d'accueil (Partager > Sur l'écran d'accueil), puis ouvrez-la depuis son icône."
        : "Ce navigateur ne permet pas les notifications. Utilisez l'app installée sur l'écran d'accueil.";
      on.hidden = true; off.hidden = true; return;
    }
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (Notification.permission === "denied") { etat.textContent = "Les notifications sont bloquées pour cette app. Autorisez-les dans les réglages du téléphone, puis revenez ici."; on.hidden = true; off.hidden = true; return; }
    etat.textContent = sub ? "Rappel activé sur cet appareil." : "Rappel non activé sur cet appareil.";
    majCloche(!!sub);
    on.hidden = !!sub; off.hidden = !sub;
  }
  const peutNotifier = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && Notification.permission !== "denied";
  $("#rappel-activer").addEventListener("click", () => activerRappel());
  async function activerRappel() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { await etatRappel(); return; }
      const { data, error } = await sb.functions.invoke("rappel-bilan", { body: { action: "cle" } });
      if (error || !data || !data.cle) throw new Error("cle");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(data.cle) });
      const j = sub.toJSON();
      const { error: e2 } = await sb.from("abonnements").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      if (e2) throw e2;
      await sb.functions.invoke("rappel-bilan", { body: { action: "test" } });
      status("Rappel activé : une notification d'essai vient d'être envoyée.");
    } catch (err) { console.error(err); status("Le rappel n'a pas pu être activé. Réessayez, ou vérifiez que l'app est installée sur l'écran d'accueil."); }
    etatRappel();
  }
  $("#rappel-desactiver").addEventListener("click", async () => {
    try {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (sub) { await sb.from("abonnements").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
      status("Rappel désactivé sur cet appareil.");
    } catch (err) { console.error(err); }
    etatRappel();
  });
  function showRappel(open) {
    $("#rappel").hidden = !open;
    if (open) { $("#help").hidden = true; $("#membres").hidden = true; $("#commis").hidden = true; etatRappel(); $("#rappel").scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  $("#open-rappel").addEventListener("click", async () => {
    if (!rappelActif && peutNotifier()) { await activerRappel(); if (!rappelActif) showRappel(true); return; }
    showRappel($("#rappel").hidden);
  });
  $("#close-rappel").addEventListener("click", () => showRappel(false));

  function renderMaison() {
    renderLieux();
    renderBilan();
    renderPanier();
    const act = document.activeElement;
    if (act && act.closest && act.closest("#v-maison [data-keep]")) return;
    const esp = espacesTries();
    const bas = state.prod.filter(estBas);
    const exp = bientot();
    const alertes = bas.length + exp.length + state.panier.length;
    $("#c-maison").textContent = alertes;
    $("#c-maison").classList.toggle("hot", alertes > 0);
    const enListe = new Set(state.liste.filter((i) => !i.fait).map((i) => norm(i.nom)));
    const aAjouter = bas.filter((p) => !enListe.has(norm(p.nom)));
    $("#maison-alerte").innerHTML = bas.length
      ? `<div class="mix"><b>${bas.length} produit${bas.length > 1 ? "s" : ""} sous le minimum</b> : ${bas.map((p) => esc(p.nom)).join(", ")}.
          ${aAjouter.length ? `<br><button class="link" type="button" id="add-bas">Ajouter ${aAjouter.length > 1 ? "les " + aAjouter.length + " manquants" : "le manquant"} à la liste</button>` : " Déjà dans la liste."}</div>`
      : "";
    if (exp.length) $("#maison-alerte").innerHTML += `<div class="mix exp-box"><b>À consommer bientôt</b> : ${exp.map((p) => `${esc(p.nom)} (${expTag(p).replace(/<[^>]+>/g, "")})`).join(", ")}.</div>`;
    const q = norm($("#in-msearch").value);
    const match = (p) => !q || norm([p.nom, p.marque, p.format].join(" ")).includes(q);
    if (!esp.length) {
      $("#list-maison").innerHTML = emptyBox("Aucun espace", "Créez vos espaces (garde-manger, frigo, congélateur…) dans « Gérer les espaces » ci-dessous.");
    } else {
      $("#list-maison").innerHTML = esp.map((e) => {
        const items = state.prod.filter((p) => p.espace_id === e.id && Number(p.stock || 0) > 0 && match(p)).sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)));
        if (q && !items.length) return "";
        return `<div class="espace">
          <div class="espace-head"><h2>${esc(e.nom)}</h2><span class="hint">${items.length} produit${items.length > 1 ? "s" : ""}</span></div>
          ${items.length ? `<ul class="list">${items.map((p) => `<li>
            ${thumb(p.photo, p.nom)}
            <div class="main"><div class="name">${esc(p.nom)}${estBas(p) ? '<span class="sale low-tag">à racheter</span>' : ""}</div>
              <div class="meta">${expTag(p)}${expTag(p) ? " · " : ""}${esc([p.format, p.minimum != null ? "minimum " + fmtQ(p.minimum) : ""].filter(Boolean).join(" · "))}${p.format || p.minimum != null ? " · " : ""}<button class="link move-link" type="button" data-move="${p.id}">${moveOpen === p.id ? "Annuler" : "Déplacer"}</button> · <button class="link move-link" type="button" data-dateopen="${p.id}">Péremption</button> · <button class="link move-link del-link" type="button" data-effacer="${p.id}">Effacer</button></div></div>
            ${stockCtl(p)}
            ${moveOpen === p.id ? `<div class="move-row" data-keep><span class="hint">Déplacer vers :</span>
              <div class="move-choices">${espacesTries().filter((x) => x.id !== p.espace_id).map((x) => `<button class="chip-btn" type="button" data-moveto="${x.id}" data-id="${p.id}">${esc(x.nom)}</button>`).join("")}
              <button class="chip-btn muted" type="button" data-moveto="" data-id="${p.id}">Sans espace</button></div></div>` : ""}
            ${dateOpen === p.id ? `<div class="move-row" data-keep><label class="mf">Date de péremption
                <input type="date" id="pd-${p.id}" value="${esc(p.peremption || "")}" data-dfield="peremption" data-id="${p.id}"></label>
              <div class="move-choices"><button class="chip-btn muted" type="button" data-dateclear="${p.id}">Aucune date</button><button class="chip-btn muted" type="button" data-dateopen="${p.id}">Fermer</button></div></div>` : ""}
            ${delOpen === p.id ? `<div class="move-row del-row" data-keep><span class="hint">Effacer « ${esc(p.nom)} » ?</span>
              <div class="move-choices">
                <button class="chip-btn" type="button" data-retirer-maison="${p.id}">Il n'y en a plus (mettre à 0)</button>
                <button class="chip-btn danger" type="button" data-effacer-ok="${p.id}">Supprimer complètement</button>
                <button class="chip-btn muted" type="button" data-effacer-annuler>Annuler</button>
              </div>
              <span class="hint">« Il n'y en a plus » le retire du lieu mais le garde dans l'onglet Produits (prix, photo, espace habituel). « Supprimer complètement » l'efface de l'onglet Produits aussi.</span></div>` : ""}</li>`).join("")}</ul>`
          : `<p class="hint espace-vide">Rien en réserve ici pour l'instant.</p>`}
        </div>`;
      }).join("") || emptyBox("Aucun produit trouvé", `Rien ne correspond à « ${esc($("#in-msearch").value)} ».`);
    }
    const sans = state.prod.filter((p) => !p.espace_id && Number(p.stock || 0) > 0 && match(p)).sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)));
    $("#sans-espace-count").textContent = sans.length;
    $("#list-sans-espace").innerHTML = sans.length
      ? `<ul class="list" data-keep>${sans.map((p) => `<li class="sans-row">${thumb(p.photo, p.nom)}<div class="main"><div class="name">${esc(p.nom)}</div>
          <div class="meta">${esc([p.format, Number(p.stock || 0) > 0 ? fmtQ(p.stock) + " en réserve" : ""].filter(Boolean).join(" · "))}</div></div>
          <label class="mf sans-move">Déplacer vers ${espaceSelect(p, "se-" + p.id)}</label>
          <button class="icon del-icon" type="button" data-effacer="${p.id}" aria-label="Effacer ${esc(p.nom)}">🗑</button>
          ${delOpen === p.id ? `<div class="move-row del-row"><span class="hint">Effacer « ${esc(p.nom)} » ?</span>
            <div class="move-choices">
              <button class="chip-btn" type="button" data-retirer-maison="${p.id}">Il n'y en a plus (mettre à 0)</button>
              <button class="chip-btn danger" type="button" data-effacer-ok="${p.id}">Supprimer complètement</button>
              <button class="chip-btn muted" type="button" data-effacer-annuler>Annuler</button>
            </div></div>` : ""}</li>`).join("")}</ul>`
      : `<p class="hint">Tous les produits ont un espace.</p>`;
    $("#list-espaces").innerHTML = esp.map((e, i) => `<li>
        <input id="esp-${e.id}" value="${esc(e.nom)}" aria-label="Nom de l'espace" data-espnom="${e.id}">
        <button class="icon" type="button" data-espmove="-1" data-id="${e.id}" aria-label="Monter" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="icon" type="button" data-espmove="1" data-id="${e.id}" aria-label="Descendre" ${i === esp.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon" type="button" data-del="espaces" data-id="${e.id}" aria-label="Supprimer ${esc(e.nom)}">✕</button></li>`).join("");
  }
  async function ajusterStock(id, delta) {
    const p = state.prod.find((x) => x.id === id); if (!p) return;
    const avant = Number(p.stock || 0), apres = Math.max(0, avant + delta);
    if (apres === avant) return;
    p.stock = apres; if (apres === 0) p.peremption = null; render();
    await majInv(id, apres === 0 ? { stock: 0, peremption: null } : { stock: apres });
    if (delta < 0 && estBas(p) && !(avant <= Number(p.minimum))) {
      if (!dansListe(p.nom, listeDe(p))) {
        if (await run(sb.from("epicerie").insert({ nom: p.nom, liste_id: listeDe(p), ...(p.photo ? { photo: p.photo } : {}) }), `« ${p.nom} » est sous le minimum : ajouté à « ${nomListe(listeDe(p))} ».`)) scheduleReload("epicerie");
      }
    }
  }

  function productDetail(p, b) {
    const pid = p.id;
    return `<div class="prod-detail" data-stop>
      <div class="prod-photo">
        ${p.photo ? `<img src="${esc(urls.get(p.photo) || "")}" alt="${esc(p.nom)}" data-zoom="${esc(p.photo)}">` : ""}
        <button class="btn ghost" type="button" data-prodphoto="${pid}">${p.photo ? "Changer la photo" : "Ajouter une photo"}</button>
      </div>
      <div class="edit-fields">
        <input id="e-nom-${pid}" value="${esc(p.nom)}" aria-label="Nom" data-pfield="nom" data-id="${pid}">
        <input id="e-marque-${pid}" value="${esc(p.marque || "")}" placeholder="Marque" aria-label="Marque" data-pfield="marque" data-id="${pid}">
        <input id="e-format-${pid}" value="${esc(p.format || "")}" placeholder="Format" aria-label="Format" data-pfield="format" data-id="${pid}">
        <select id="e-cat-${pid}" aria-label="Catégorie" data-pfield="categorie" data-id="${pid}">${CATS.map((c) => `<option ${c === (p.categorie || "Autre") ? "selected" : ""}>${c}</option>`).join("")}</select>
      </div>
      <div class="edit-fields maison-fields">
        <label class="mf">Espace ${espaceSelect(p, "e-esp-" + pid)}</label>
        <label class="mf">Liste habituelle <select id="e-lst-${pid}" data-pfield="liste_id" data-id="${pid}"><option value="">Liste ouverte</option>${listesTriees().map((l) => `<option value="${l.id}" ${l.id === p.liste_id ? "selected" : ""}>${esc(l.nom)}</option>`).join("")}</select></label>
        <label class="mf">En réserve ${stockCtl(p)}</label>
        <label class="mf">Prix cible : m'avertir seulement sous <input id="e-cible-${pid}" inputmode="decimal" placeholder="Tout rabais" value="${p.prix_cible != null ? esc(String(p.prix_cible).replace(".", ",")) : ""}" data-nfield="prix_cible" data-id="${pid}"></label>
        <label class="mf">Péremption <input type="date" id="e-per-${pid}" value="${esc(p.peremption || "")}" data-dfield="peremption" data-id="${pid}"></label>
        <label class="mf">Minimum à garder <input id="e-min-${pid}" inputmode="decimal" placeholder="Aucun" value="${p.minimum != null ? esc(fmtQ(p.minimum)) : ""}" data-nfield="minimum" data-id="${pid}"></label>
      </div>
      ${state.lieux.length > 1 ? `<fieldset class="lieux-prod"><legend>Ce produit est à</legend>${lieuxTries().map((l) => `<label><input type="checkbox" data-plieu="${l.id}" data-id="${pid}" ${dansLieu(p, l.id) ? "checked" : ""}> ${esc(l.nom)}</label>`).join("")}</fieldset>` : ""}
      <p class="hint prix-expl">${p.surveiller ? "★ Surveillé : Rosalie vérifie ses prix chaque jeudi et vous montre ses rabais dans Spéciaux." : "Prix réguliers par épicerie. Rosalie les met à jour le jeudi (les produits ★ en premier), et vos factures aussi. Vous pouvez les taper vous-même."}</p>
      <div class="price-grid">${stores().map((s, ix) => {
        const e = (p.prix && p.prix[s]) || {}; const pr = priceAt(p, s);
        return `<div class="pcell${b && b.store === s ? " best" : ""}"><label for="pr-${pid}-${ix}">${esc(s)}</label>
          <input id="pr-${pid}-${ix}" inputmode="decimal" placeholder="Prix régulier" value="${e.reg != null ? esc(String(e.reg)) : ""}" data-price="${esc(s)}" data-id="${pid}">
          ${pr && pr.special ? `<span class="sp">Spécial ${money(pr.val)}${pr.fin ? ` · ${fmtDate(pr.fin)}` : ""}</span>` : ""}
          ${e.maj ? `<span class="when">${({ agent: "circulaire", facture: "votre facture", manuel: "tapé à la main" })[e.par] || "mis à jour"} · ${fmtDate(e.maj)}</span>` : `<span class="when">pas encore de prix</span>`}
        </div>`;
      }).join("")}</div>
      <div class="row-actions">
        <button class="link" type="button" data-tolist="${pid}">Ajouter à la liste</button>
        <button class="link" type="button" data-survtoggle="${pid}">${p.surveiller ? "★ Ne plus surveiller" : "☆ Surveiller les spéciaux"}</button>
        ${state.lieux.length > 1 && dansLieu(p) && Array.isArray(p.lieux) && p.lieux.length > 1 ? `<button class="link muted" type="button" data-retirerlieu="${pid}">Retirer de « ${esc(nomLieu())} »</button>` : ""}
        <button class="link muted" type="button" data-del="produits" data-id="${pid}">Supprimer ${state.lieux.length > 1 ? "partout" : "des produits"}</button>
      </div>
    </div>`;
  }

  async function changerLieuxProduit(p, liste) {
    if (!liste.length) { status("Un produit doit rester dans au moins un lieu. Pour l'enlever partout, touchez « Supprimer partout »."); render(); return; }
    p.lieux = liste; render();
    if (!(await run(sb.from("produits").update({ lieux: liste }).eq("id", p.id)))) scheduleReload("produits");
  }
  document.addEventListener("change", (e) => {
    const c = e.target.closest("[data-plieu]"); if (!c) return;
    const p = state.prod.find((x) => x.id === c.dataset.id); if (!p) return;
    if (!c.checked && c.dataset.plieu === idLieu()) { c.blur(); openProd = null; }
    const cur = Array.isArray(p.lieux) && p.lieux.length ? p.lieux : state.lieux.map((l) => l.id);
    changerLieuxProduit(p, c.checked ? [...new Set([...cur, c.dataset.plieu])] : cur.filter((x) => x !== c.dataset.plieu));
  });
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-lieuajout]");
    if (a) {
      const p = state.prod.find((x) => x.id === a.dataset.lieuajout); if (!p) return;
      await ajouterAuLieu(p); search = ""; $("#in-pnom").value = ""; majAjoutRapide(); openProd = p.id; render();
      status(`« ${p.nom} » est maintenant aussi à « ${nomLieu()} ».`); return;
    }
    const r = e.target.closest("[data-retirerlieu]");
    if (r) {
      const p = state.prod.find((x) => x.id === r.dataset.retirerlieu); if (!p) return;
      if (document.activeElement) document.activeElement.blur();
      openProd = null; await changerLieuxProduit(p, (p.lieux || []).filter((x) => x !== idLieu()));
      status(`« ${p.nom} » retiré de « ${nomLieu()} ». Il reste ailleurs.`);
    }
  });

  // Menu sous le titre : l'élément dont le panneau est ouvert devient vert
  const MENU = [["#open-compte", "#compte"], ["#open-rappel", "#rappel"]];
  function majMenu() {
    MENU.forEach(([b, pan]) => { const btn = $(b), el = $(pan); if (btn && el) btn.setAttribute("aria-expanded", String(!el.hidden)); });
  }
  const obsMenu = new MutationObserver(majMenu);
  MENU.forEach(([, pan]) => { const el = $(pan); if (el) obsMenu.observe(el, { attributes: true, attributeFilter: ["hidden"] }); });
  majMenu();

  // ---------- data
  const TABLES = { epicerie: "liste", speciaux: "spec", produits: "prod", espaces: "espaces", panier: "panier", listes: "listes", lieux: "lieux", inventaire: "inv", economies: "eco" };
  async function load(table) {
    if (table === "foyers") {
      const { data } = await sb.from("foyers").select("*").maybeSingle();
      if (data) state.foyer = data; renderForfait(); return;
    }
    if (table === "membres") {
      const { data } = await sb.from("membres").select("id, email, telephone, nom, invite_par, role");
      if (data) state.membres = data;
      renderMembres(); return;
    }
    if (table === "config") {
      const { data } = await sb.from("config").select("*").limit(1).maybeSingle();
      state.config = data; return;
    }
    if (table === "inventaire") {
      const { data, error } = await sb.from("inventaire").select("*").limit(5000);
      if (!error) state.inv = data || [];
      appliquerLieu(); return;
    }
    const { data, error } = await sb.from(table).select("*").order("cree", { ascending: true, nullsFirst: true }).limit(2000);
    if (error && table === "speciaux") { const r = await sb.from(table).select("*").limit(2000); state[TABLES[table]] = r.data || []; return; }
    if (!error) state[TABLES[table]] = data || [];
    if (table === "produits" || table === "lieux") appliquerLieu();
  }
  async function loadAll() {
    await Promise.all(["epicerie", "produits", "espaces", "panier", "listes", "lieux", "inventaire", "config", "economies"].map(load).concat(
      sb.from("speciaux").select("*").limit(2000).then(({ data }) => { state.spec = data || []; })));
    render();
  }
  const pending = {};
  function scheduleReload(table) {
    clearTimeout(pending[table]);
    pending[table] = setTimeout(async () => {
      if (table === "speciaux") { const { data } = await sb.from("speciaux").select("*").limit(2000); state.spec = data || []; }
      else await load(table);
      if (table === "produits") await load("inventaire");
      render();
    }, 250);
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("epicerie-live");
    ["epicerie", "speciaux", "produits", "espaces", "panier", "listes", "lieux", "inventaire", "config", "membres", "foyers", "economies"].forEach((t) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => scheduleReload(t)));
    channel.subscribe();
  }

  async function run(promise, okMsg) {
    const { error } = await promise;
    if (error) {
      if (error.code === "23505") return true; // already exists
      status("La modification n'a pas été enregistrée. Vérifiez votre connexion et réessayez.");
      console.error(error);
      return false;
    }
    status(okMsg || "");
    return true;
  }
  async function ensureProduct(nom, extra) {
    const ex = extra || {};
    const p = state.prod.find((x) => norm(x.nom) === norm(nom));
    if (p) {
      if (!dansLieu(p)) await ajouterAuLieu(p);
      const maj = {};
      if (ex.photo && !p.photo) maj.photo = ex.photo;
      if (ex.marque && !p.marque) maj.marque = ex.marque;
      if (ex.format && !p.format) maj.format = ex.format;
      if (ex.categorie && ex.categorie !== "Autre" && (!p.categorie || p.categorie === "Autre")) maj.categorie = ex.categorie;
      if (Object.keys(maj).length) { await run(sb.from("produits").update(maj).eq("id", p.id)); scheduleReload("produits"); }
      return;
    }
    const row = { nom, lieux: [idLieu()].filter(Boolean) };
    ["marque", "format", "categorie", "photo"].forEach((k) => { if (ex[k]) row[k] = ex[k]; });
    await run(sb.from("produits").insert(row));
    scheduleReload("produits");
  }

  // ---------- membres
  const MAX_MEMBRES = 4;
  const APP_URL = location.origin + location.pathname.replace(/index\.html$/, "");
  let retraitEnAttente = null;
  let telEnEdition = null;
  function renderMembres() {
    const lib = (x) => x.nom || (x.telephone ? fmtTel(x.telephone) : x.email) || "Membre";
    const m = [...state.membres].sort((a, b) => lib(a).localeCompare(lib(b)));
    $("#membres-count").textContent = `${m.length} sur ${MAX_MEMBRES}`;
    const plein = m.length >= MAX_MEMBRES;
    $("#f-membre").hidden = plein; $("#membres-plein").hidden = !plein;
    $("#list-membres").innerHTML = m.map((x) => {
      const moi = estMoi(x);
      const conf = retraitEnAttente === x.id;
      const contact = [x.telephone ? "☎ " + fmtTel(x.telephone) : "", x.email || ""].filter(Boolean).join(" · ");
      return `<li class="membre-row"><div class="main"><div class="name">${esc(lib(x))}${moi ? ' <span class="meta">(vous)</span>' : ""}${x.role === "proprio" ? ' <span class="role-tag">Propriétaire</span>' : ""}</div>
        <div class="meta">${esc(contact)}${!x.telephone && telEnEdition !== x.id ? ` · <button class="link move-link" type="button" data-settel="${x.id}">+ Ajouter le cellulaire</button>` : ""}</div></div>
        ${m.length > 1 ? (conf
          ? `<button class="link" type="button" data-retirer-ok="${x.id}" style="color:var(--danger)">${moi ? "Me retirer" : "Confirmer le retrait"}</button><button class="link muted" type="button" data-retirer-annuler>Annuler</button>`
          : `<button class="icon" type="button" data-retirer="${x.id}" aria-label="Retirer ${esc(lib(x))}">✕</button>`) : ""}
        ${telEnEdition === x.id ? `<form class="add tel-edit" data-telform="${x.id}"><input id="tel-${x.id}" type="tel" inputmode="tel" placeholder="Cellulaire (514 555-1234)" aria-label="Cellulaire de ${esc(lib(x))}" required>
          <button class="btn" type="submit">Enregistrer</button><button class="link muted" type="button" data-settel-annuler>Annuler</button></form>` : ""}</li>`;
    }).join("");
    if (telEnEdition) { const i = document.getElementById("tel-" + telEnEdition); if (i) i.focus(); }
  }
  function showMembres(open) {
    $("#membres").hidden = !open;
    if (open) { fermerPanneaux("#membres"); renderMembres(); $("#membres").scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  $("#open-membres").addEventListener("click", () => showMembres($("#membres").hidden));
  $("#close-membres").addEventListener("click", () => showMembres(false));
  let inviteMsg = "", inviteTel = "";
  const msgErreurMembre = (error, quoi) => {
    const msg = String((error && error.message) || "");
    return msg.includes("limite_membres") ? "La limite de 4 membres est atteinte."
      : msg.includes("cellulaire_invalide") ? "Ce numéro de cellulaire ne semble pas valide (10 chiffres)."
      : msg.includes("courriel_invalide") ? "Ce courriel ne semble pas valide. Vérifiez-le."
      : error && error.code === "23505" ? `${quoi} est déjà membre.`
      : "La modification n'a pas été enregistrée. Vérifiez votre connexion et réessayez.";
  };
  $("#f-membre").addEventListener("submit", async (e) => {
    e.preventDefault();
    const tel = $("#in-mtel").value.trim(), nom = $("#in-mnom").value.trim();
    if (!tel) return;
    if (!e164(tel)) { status("Entrez un numéro de cellulaire à 10 chiffres, par exemple 514 555-1234."); return; }
    if (state.membres.some((x) => x.telephone && tel10(x.telephone) === tel10(tel))) { status(`${fmtTel(tel)} est déjà membre.`); return; }
    if (state.membres.length >= MAX_MEMBRES) { status("La limite de 4 membres est atteinte."); return; }
    $("#btn-inviter").disabled = true;
    const { error } = await sb.from("membres").insert({ telephone: tel, nom });
    $("#btn-inviter").disabled = false;
    if (error) { status(msgErreurMembre(error, fmtTel(tel))); return; }
    $("#in-mtel").value = ""; $("#in-mnom").value = "";
    const moi = (state.membres.find(estMoi) || {}).nom || "";
    inviteMsg = `${nom ? "Salut " + nom + "! " : ""}${moi ? prenom(moi) + " t'invite" : "Je t'invite"} dans notre foyer sur Le Commis : la liste d'épicerie, ce qu'on a à la maison et les spéciaux, partagés en temps réel. Ouvre ${APP_URL}, touche « Continuer avec HoldingAI » et utilise ton cellulaire ${fmtTel(tel)} : si tu n'as pas encore de compte HoldingAI, tu le crées avec un code par texto.`;
    inviteTel = e164(tel);
    $("#invite-text").textContent = `${nom || fmtTel(tel)} a accès. Envoyez-lui ce message pour qu'elle ou il crée son compte :\n\n« ${inviteMsg} »`;
    $("#invite-send").hidden = !navigator.share;
    $("#invite-sms").href = `sms:${inviteTel}?&body=${encodeURIComponent(inviteMsg)}`;
    $("#invite-share").hidden = false;
    status("");
    await load("membres");
  });
  $("#invite-send").addEventListener("click", async () => {
    try { await navigator.share({ title: "Le Commis", text: inviteMsg }); } catch (e) {}
  });
  $("#invite-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(inviteMsg); status("Message copié. Collez-le dans un texto ou un courriel."); }
    catch (e) { status("Copie impossible ici : sélectionnez le message à la main."); }
  });
  $("#list-membres").addEventListener("click", async (e) => {
    const st = e.target.closest("[data-settel]");
    if (st) { telEnEdition = st.dataset.settel; renderMembres(); return; }
    if (e.target.closest("[data-settel-annuler]")) { telEnEdition = null; renderMembres(); return; }
    const r = e.target.closest("[data-retirer]");
    if (r) { retraitEnAttente = r.dataset.retirer; renderMembres(); return; }
    if (e.target.closest("[data-retirer-annuler]")) { retraitEnAttente = null; renderMembres(); return; }
    const ok = e.target.closest("[data-retirer-ok]");
    if (!ok) return;
    const id = ok.dataset.retirerOk; retraitEnAttente = null;
    const cible = state.membres.find((x) => x.id === id);
    const { error } = await sb.from("membres").delete().eq("id", id);
    if (error) { status(String(error.message || "").includes("dernier_membre") ? "Il faut garder au moins un membre." : "Le retrait n'a pas fonctionné. Réessayez."); renderMembres(); return; }
    if (estMoi(cible)) { await deconnecter(); return; }
    status(`${(cible && (cible.nom || fmtTel(cible.telephone) || cible.email)) || "Ce membre"} n'a plus accès.`);
    await load("membres");
  });
  $("#list-membres").addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-telform]"); if (!f) return;
    e.preventDefault();
    const id = f.dataset.telform, tel = f.querySelector("input").value.trim();
    if (!e164(tel)) { status("Entrez un numéro de cellulaire à 10 chiffres, par exemple 514 555-1234."); return; }
    const { error } = await sb.from("membres").update({ telephone: tel }).eq("id", id);
    if (error) { status(msgErreurMembre(error, fmtTel(tel))); return; }
    telEnEdition = null; status("Cellulaire enregistré. Cette personne peut maintenant créer son compte avec son cellulaire.");
    await load("membres");
  });

  // ---------- aide : guide complet
  const fermerPanneaux = (sauf) => ["#help", "#membres", "#rappel", "#commis", "#offrir", "#idee", "#compte"].forEach((id) => { if (id !== sauf) $(id).hidden = true; });
  function showHelp(open) {
    $("#help").hidden = !open;
    if (open) { fermerPanneaux("#help"); $("#help").scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  $("#open-help").addEventListener("click", () => showHelp(true));
  $("#open-visite").addEventListener("click", () => { $("#commis").hidden = true; visiteCommis(false); });
  $("#close-help").addEventListener("click", () => showHelp(false));
  $("#close-help-2").addEventListener("click", () => showHelp(false));

  // ---------- accueil des nouveaux (comme Le 19e)
  const prenom = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const moiMembre = () => state.membres.find(estMoi) || null;
  const cleAccueil = () => "accueil." + (state.userId || "");
  const installee = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  function invitePar(me) {
    if (!me || !me.invite_par) return null;
    const m = state.membres.find((x) => !estMoi(x) && memeContact(x, me.invite_par));
    return m ? prenom(m.nom) || null : null;
  }
  // Visite guidée par le Commis en personne (avatar). Repli : la carte de bienvenue ci-dessous.
  function visiteCommis(premiere) {
    if (!window.CommisGuide) return false;
    const me = moiMembre() || {}, nom = prenom(me.nom), parQui = invitePar(me);
    const intro = premiere
      ? (parQui ? `${parQui} vous a invité à partager l'épicerie de la maison. ` : "") + "Je tiens l'épicerie avec vous : ce que vous achetez, ce que vous avez, ce qui manque et ce qui est en rabais. Voici comment je travaille, en six petites étapes."
      : "Voici comment je travaille, en six petites étapes.";
    CommisGuide.ouvrir({
      etapes: [{ puce: "Bonjour!", icone: "bonjour", titre: `Bienvenue${nom ? ", " + nom : ""}! Moi, c'est Rosalie, votre commis.`, texte: intro }].concat(CommisGuide.CONCEPTS),
      fin: { titre: "À vous de jouer!", texte: "Commencez par photographier trois ou quatre produits que vous achetez souvent. La carte « Bien démarrer » vous guide ensuite. Une question? Touchez « Aide » en haut : je réponds.", bouton: "Commencer" },
      onFermer: () => { lsSet(cleAccueil(), String(Date.now())); renderDemarrer(); window.scrollTo({ top: 0, behavior: "smooth" }); },
    });
    return true;
  }
  function montrerBienvenue() {
    if (visiteCommis(true)) return;
    const me = moiMembre() || {}, nom = prenom(me.nom), parQui = invitePar(me);
    const autres = state.membres.filter((x) => !estMoi(x)).map((x) => prenom(x.nom)).filter(Boolean);
    const box = $("#bienvenue");
    box.innerHTML = `<div class="bv-in">
      <div class="bv-card" aria-hidden="true"><span class="bv-hole"></span><div class="bv-brand">Le Commis</div>
        <div class="bv-name">${esc(me.nom || "Bienvenue")}</div><div class="bv-sub">${autres.length ? "avec " + esc(autres.join(", ")) : "Membre"}</div></div>
      <h1 id="bv-title">Bienvenue${nom ? ", " + esc(nom) : ""}.</h1>
      <p class="bv-lead">${parQui ? esc(parQui) + " vous a invité" + " à partager l'épicerie de la maison." : "Vous partagez maintenant l'épicerie de la maison."} Tout ce que vous ajoutez apparaît aussitôt chez les autres.</p>
      <ol class="bv-tabs">
        <li><b>Produits</b><span>Tous vos produits. Photographiez-en un pour l'ajouter. L'étoile ★ surveille ses spéciaux.</span></li>
        <li><b>Lieu</b><span>Ce que vous avez, rangé par espace, avec les dates de péremption.</span></li>
        <li><b>Liste épicerie</b><span>Ce qu'il faut acheter. Cochez en magasin.</span></li>
        <li><b>Spéciaux</b><span>Chaque jeudi, les rabais sur vos produits ★.</span></li>
      </ol>
      <p class="bv-commis"><span class="commis-av" aria-hidden="true">C</span> Une question ? Touchez <b>Aide</b> en haut : Rosalie, votre commis, vous répond.</p>
      <button class="btn bv-go" type="button" id="bv-go">Commencer</button>
    </div>`;
    box.hidden = false;
    $("#bv-go").onclick = () => { lsSet(cleAccueil(), String(Date.now())); box.hidden = true; renderDemarrer(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    setTimeout(() => $("#bv-go").focus(), 60);
  }
  function maybeBienvenue() { if (state.userId && !lsGet(cleAccueil())) montrerBienvenue(); }

  // Installer sur l'écran d'accueil
  // ---------- Installer l'app sur le téléphone
  // Android et ordinateur (Chrome, Edge, Samsung) : le navigateur offre l'installation en un geste.
  // iPhone : Apple ne le permet pas, alors on montre les 3 gestes dans Safari.
  let promptInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstall = e; majInstall(); });
  window.addEventListener("appinstalled", () => {
    promptInstall = null; lsSet("demarrer.ecran", "1"); $("#ecran-sheet").hidden = true;
    majInstall(); renderDemarrer(); status("Le Commis est installé! Ouvrez-le depuis sa nouvelle icône.");
  });
  function majInstall() {
    const montrer = !installee();
    document.querySelectorAll("[data-installer]").forEach((b) => { b.hidden = !montrer; });
  }
  const UA = navigator.userAgent;
  const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/.test(UA);
  const DANS_APP = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|Snapchat|TikTok|LinkedInApp|GSA\//.test(UA);
  const PAS_SAFARI = IOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA);
  const PARTAGE_SVG = `<svg class="ec-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  async function montrerEcran() {
    if (installee()) { status("Le Commis est déjà installé sur cet appareil."); return; }
    // Un geste : la fenêtre d'installation du navigateur
    if (promptInstall) {
      const e = promptInstall; promptInstall = null;
      try {
        await e.prompt();
        const r = await e.userChoice;
        if (r && r.outcome === "accepted") { lsSet("demarrer.ecran", "1"); renderDemarrer(); majInstall(); status("Installation en cours : l'icône Le Commis apparaît sur votre écran d'accueil."); return; }
      } catch (err) {}
      majInstall();
    }
    const box = $("#ecran-sheet"), lien = APP_URL;
    let etapes, avant = "";
    if (IOS && (DANS_APP || PAS_SAFARI)) {
      avant = `<p class="ec-alerte">Sur iPhone, l'installation se fait seulement dans <b>Safari</b>. Cette page est ouverte dans une autre app.</p>`;
      etapes = `<li>Touchez <b>Copier le lien</b> ci-dessous.</li><li>Ouvrez <b>Safari</b> et collez le lien dans la barre d'adresse.</li><li>Puis suivez les 3 étapes qui s'afficheront.</li>`;
    } else if (IOS) {
      etapes = `<li>Touchez le bouton <b>Partager</b> ${PARTAGE_SVG} en bas de l'écran (ou <b>⋯</b> puis <b>Partager</b>).</li><li>Descendez et choisissez <b>Sur l'écran d'accueil</b>.</li><li>Touchez <b>Ajouter</b>. L'icône Le Commis apparaît avec vos autres apps.</li>`;
    } else if (ANDROID && DANS_APP) {
      avant = `<p class="ec-alerte">Cette page est ouverte dans une autre app. Ouvrez-la dans <b>Chrome</b> pour l'installer.</p>`;
      etapes = `<li>Touchez le menu <b>⋮</b> en haut à droite.</li><li>Choisissez <b>Ouvrir dans Chrome</b> (ou <b>Ouvrir dans le navigateur</b>).</li><li>Touchez ensuite <b>📲 Installer l'app</b>.</li>`;
    } else if (ANDROID && /SamsungBrowser/.test(UA)) {
      etapes = `<li>Touchez le menu <b>≡</b> en bas à droite.</li><li>Choisissez <b>Ajouter page à</b> puis <b>Écran d'accueil</b>.</li><li>Touchez <b>Ajouter</b>.</li>`;
    } else if (ANDROID) {
      etapes = `<li>Touchez le menu <b>⋮</b> en haut à droite.</li><li>Choisissez <b>Installer l'application</b> (ou <b>Ajouter à l'écran d'accueil</b>).</li><li>Touchez <b>Installer</b>.</li>`;
    } else {
      etapes = `<li><b>Sur votre téléphone</b>, ouvrez <b>${esc(lien.replace(/^https:\/\//, "").replace(/\/$/, ""))}</b> et touchez <b>📲 Installer l'app</b>.</li><li><b>Sur cet ordinateur</b> (Chrome ou Edge) : touchez l'icône d'installation à droite de la barre d'adresse.</li><li>Sur Mac avec Safari : menu <b>Fichier</b> puis <b>Ajouter au Dock</b>.</li>`;
    }
    box.innerHTML = `<div class="bv-in">
      <img class="ec-icone" src="icons/icon-192.png" alt="" width="72" height="72">
      <h1 id="ec-title">Installer Le Commis</h1>
      <p class="bv-lead">Une vraie icône sur votre écran d'accueil : l'app s'ouvre en plein écran, et le rappel du soir peut vous joindre.</p>
      ${avant}<ol class="bv-steps">${etapes}</ol>
      ${IOS ? `<p class="hint">Sur iPhone, connectez-vous dans l'app installée : elle garde sa propre session.</p>` : ""}
      <div class="row-actions">${(IOS && (DANS_APP || PAS_SAFARI)) || (!IOS && !ANDROID) ? `<button class="btn" type="button" id="ec-copier">Copier le lien</button>` : ""}<button class="btn${(IOS && (DANS_APP || PAS_SAFARI)) || (!IOS && !ANDROID) ? " ghost" : ""}" type="button" id="ec-ok">C'est fait</button><button class="link muted" type="button" id="ec-later">Plus tard</button></div>
    </div>`;
    box.hidden = false;
    const c = $("#ec-copier");
    if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(lien + "?installer"); c.textContent = "Lien copié ✓"; } catch (err) { c.textContent = lien; } };
    $("#ec-ok").onclick = () => { lsSet("demarrer.ecran", "1"); box.hidden = true; renderDemarrer(); };
    $("#ec-later").onclick = () => { box.hidden = true; };
    setTimeout(() => $("#ec-ok").focus(), 50);
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-installer]")) montrerEcran(); });
  if (new URLSearchParams(location.search).has("installer")) setTimeout(montrerEcran, 600);
  majInstall();

  // ---------- Installation obligatoire sur cellulaire (comme Le Gousset) ----------
  // Sur téléphone ou tablette, tant que Le Commis n'est pas ouvert depuis son icône, un écran plein montre comment l'installer.
  // Sur ordinateur, rien ne change.
  const MOBILE = IOS || ANDROID || /Mobile/.test(UA);
  function renderGate() {
    const g = $("#install-gate"); if (!g || g.hidden) return;
    if (window.CommisGuide) $("#gate-av").innerHTML = CommisGuide.avatar();
    const code = refGet();
    const cadeau = code ? `<p class="gate-cadeau">🎁 Votre code cadeau : <b>${esc(code)}</b>. ${IOS ? "Notez-le : entrez-le à l'inscription, dans l'app installée (« J'ai un code cadeau »)." : "Il vous suivra dans l'app."}</p>` : "";
    if (promptInstall) {
      $("#gate-body").innerHTML = `${cadeau}<button class="btn gate-btn" type="button" id="gate-installer">📲 Installer Le Commis</button>
        <p class="hint">Ensuite, ouvrez Le Commis depuis sa nouvelle icône.</p>`;
      $("#gate-installer").onclick = async () => {
        const e = promptInstall; promptInstall = null;
        try { await e.prompt(); const r = await e.userChoice; if (r && r.outcome === "accepted") { gateInstallee(); return; } } catch (err) {}
        renderGate();
      };
      return;
    }
    let avant = "", etapes;
    if (IOS && (DANS_APP || PAS_SAFARI)) {
      avant = `<p class="ec-alerte">Sur iPhone, l'installation se fait seulement dans <b>Safari</b>. Cette page est ouverte dans une autre app.</p>`;
      etapes = `<li>Touchez <b>Copier le lien</b> ci-dessous.</li><li>Ouvrez <b>Safari</b> et collez le lien dans la barre d'adresse.</li><li>Suivez ensuite les 3 étapes qui s'afficheront.</li>`;
    } else if (IOS) {
      etapes = `<li>Touchez le bouton <b>Partager</b> ${PARTAGE_SVG} en bas de l'écran (ou <b>⋯</b> puis <b>Partager</b>).</li><li>Descendez et choisissez <b>Sur l'écran d'accueil</b>.</li><li>Touchez <b>Ajouter</b>, puis ouvrez Le Commis depuis sa nouvelle icône.</li>`;
    } else if (DANS_APP) {
      avant = `<p class="ec-alerte">Cette page est ouverte dans une autre app. Ouvrez-la dans <b>Chrome</b> pour l'installer.</p>`;
      etapes = `<li>Touchez le menu <b>⋮</b> en haut à droite.</li><li>Choisissez <b>Ouvrir dans Chrome</b> (ou <b>Ouvrir dans le navigateur</b>).</li><li>Touchez ensuite <b>Installer Le Commis</b>.</li>`;
    } else if (/SamsungBrowser/.test(UA)) {
      etapes = `<li>Touchez le menu <b>≡</b> en bas à droite.</li><li>Choisissez <b>Ajouter page à</b> puis <b>Écran d'accueil</b>.</li><li>Touchez <b>Ajouter</b>, puis ouvrez Le Commis depuis sa nouvelle icône.</li>`;
    } else {
      etapes = `<li>Touchez le menu <b>⋮</b> en haut à droite du navigateur.</li><li>Choisissez <b>Installer l'application</b> (ou <b>Ajouter à l'écran d'accueil</b>).</li><li>Confirmez, puis ouvrez Le Commis depuis sa nouvelle icône.</li>`;
    }
    const copier = IOS && (DANS_APP || PAS_SAFARI);
    $("#gate-body").innerHTML = `${cadeau}${avant}<ol class="bv-steps">${etapes}</ol>
      ${copier ? `<button class="btn gate-btn" type="button" id="gate-copier">Copier le lien</button>` : ""}
      ${IOS ? `<p class="hint">Dans l'app installée, touchez « Continuer avec HoldingAI » pour vous connecter.</p>` : ""}`;
    const c = $("#gate-copier");
    if (c) c.onclick = async () => { const l = APP_URL + (code ? "?ref=" + code : ""); try { await navigator.clipboard.writeText(l); c.textContent = "Lien copié ✓"; } catch (err) { c.textContent = l; } };
  }
  function gateInstallee() {
    $("#gate-body").innerHTML = `<p class="gate-ok">✓ C'est installé!</p><p>Fermez cette page et ouvrez <b>Le Commis</b> depuis sa nouvelle icône sur votre écran d'accueil.</p>`;
  }
  if (MOBILE && !installee()) {
    $("#install-gate").hidden = false; document.documentElement.classList.add("gate-on");
    setTimeout(renderGate, 0); // après le reste du script (code cadeau lu plus bas)
    window.addEventListener("beforeinstallprompt", () => setTimeout(renderGate, 0));
    window.addEventListener("appinstalled", gateInstallee);
  }


  // ---------- Bien démarrer : les étapes, avec la prochaine en évidence
  function etapesDemarrer() {
    const nProd = state.prod.length, nMaison = state.prod.filter((p) => Number(p.stock || 0) > 0).length;
    const nListe = state.liste.length, nSurv = state.prod.filter((p) => p.surveiller).length;
    return [
      { k: "ecran", done: installee() || lsGet("demarrer.ecran") === "1", t: "Mettez l'app sur votre écran d'accueil", d: "Elle s'ouvre comme une vraie app, et le rappel du soir peut vous joindre.", b: "Installer", act: montrerEcran },
      { k: "rappel", done: rappelActif, t: "Activez le rappel de 21 h", d: "Chaque soir, l'app vous demande ce qui a été consommé.", b: "Activer", act: () => activerRappel() },
      { k: "produits", done: nProd >= 5, t: "Ajoutez vos produits habituels", d: nProd ? `${nProd} produit${nProd > 1 ? "s" : ""} dans vos produits. Visez-en au moins 5. Le plus rapide : la photo.` : "Le plus rapide : touchez l'appareil photo et photographiez un produit.", b: "Photographier", act: () => { showView("produits"); $("#in-pphoto").click(); } },
      { k: "maison", done: nMaison >= 1, t: "Rangez ce que vous avez à la maison", d: "Dans l'onglet Produits, touchez un produit : choisissez son espace et mettez sa réserve avec +. Ou lisez votre dernière facture.", b: "Espace", act: () => showView("maison") },
      { k: "liste", done: nListe >= 1, t: "Commencez la liste d'épicerie", d: "Ajoutez ce qui manque. Les autres le voient aussitôt.", b: "Liste", act: () => { showView("liste"); setTimeout(() => $("#in-liste").focus(), 50); } },
      { k: "surv", done: nSurv >= 1, t: "Surveillez un spécial", d: "Dans l'onglet Produits, touchez l'étoile ☆ d'un produit que vous achetez souvent.", b: "Produits", act: () => { showView("produits"); filtre = "tous"; renderProducts(); } },
    ];
  }
  function renderDemarrer() {
    const box = $("#demarrer");
    if (!state.userId || lsGet("demarrer.masque." + state.userId) === "1" || !$("#bienvenue").hidden) { box.innerHTML = ""; return; }
    const st = etapesDemarrer(), n = st.filter((x) => x.done).length;
    if (n === st.length) { box.innerHTML = ""; return; }
    const next = st.find((x) => !x.done);
    box.innerHTML = `<section class="onboard">
      <div class="onb-head"><h2>Bien démarrer</h2><span class="onb-count">${n} / ${st.length}</span></div>
      <div class="onb-bar"><i style="width:${Math.round(n / st.length * 100)}%"></i></div>
      <ol class="onb-list">${st.map((x) => `<li class="${x.done ? "done" : x === next ? "next" : ""}"><span class="onb-dot">${x.done ? "✓" : ""}</span>
        <div class="main"><b>${esc(x.t)}</b>${x === next ? `<small>${esc(x.d)}</small>` : ""}</div>
        ${x.done ? "" : `<button class="${x === next ? "btn small" : "onb-more"}" type="button" data-onb="${x.k}" aria-label="${esc(x.b)}">${x === next ? esc(x.b) : "›"}</button>`}</li>`).join("")}</ol>
      <p class="hint onb-foot">Une question ? <button class="link" type="button" data-onb-commis>Demandez à Rosalie</button> · <button class="link muted" type="button" data-onb-masquer>Masquer</button></p>
    </section>`;
  }
  $("#demarrer").addEventListener("click", (e) => {
    const b = e.target.closest("[data-onb]");
    if (b) { const x = etapesDemarrer().find((y) => y.k === b.dataset.onb); if (x) x.act(); return; }
    if (e.target.closest("[data-onb-commis]")) return ouvrirCommis();
    if (e.target.closest("[data-onb-masquer]")) { lsSet("demarrer.masque." + state.userId, "1"); renderDemarrer(); status("Vous pouvez toujours demander de l'aide au Commis avec « Aide », en haut."); }
  });

  // ---------- avis : après deux semaines, on demande un mot pour les autres (une fois)
  const JOUR = 86400000;
  function avisAMontrer() {
    if (!state.userId || !state.userCreated || !$("#bienvenue").hidden) return false;
    const etat = lsGet("avis.etat." + state.userId) || "";
    if (etat === "envoye" || etat === "non") return false;
    if (etat.startsWith("plus-tard:") && Date.now() < Number(etat.slice(10)) + 7 * JOUR) return false;
    return Date.now() - new Date(state.userCreated).getTime() >= 14 * JOUR;
  }
  function renderAvis() {
    const box = $("#avis");
    if (!box) return;
    if (!avisAMontrer() || ($("#retour-carte") && $("#retour-carte").innerHTML)) { box.innerHTML = ""; return; }
    const me = (state.membres || []).find(estMoi);
    box.innerHTML = `<section class="avis">
      <h2>Le Commis vous rend service?</h2>
      <p class="hint">Un mot pour les autres familles qui hésitent. Ce qui a changé chez vous, ce que vous aimez, ou ce qui manque.</p>
      <form id="f-avis">
        <label class="sr-only" for="avis-texte">Votre commentaire</label>
        <textarea id="avis-texte" rows="3" maxlength="1000" required placeholder="Depuis qu'on utilise Le Commis…"></textarea>
        <div class="avis-qui">
          <input id="avis-prenom" maxlength="40" placeholder="Prénom" autocomplete="given-name" value="${esc(me && me.nom ? prenom(me.nom) : "")}">
          <input id="avis-ville" maxlength="60" placeholder="Ville" autocomplete="address-level2">
        </div>
        <label class="avis-ok"><input type="checkbox" id="avis-ok"> J'accepte que ce commentaire, mon prénom et ma ville soient affichés sur lecommis.ai.</label>
        <div class="avis-actions"><button class="btn" type="submit">Envoyer</button><button class="link" type="button" data-avis="plus-tard">Plus tard</button><button class="link muted" type="button" data-avis="non">Non merci</button></div>
      </form>
    </section>`;
  }
  $("#avis").addEventListener("click", (e) => {
    const b = e.target.closest("[data-avis]");
    if (!b) return;
    lsSet("avis.etat." + state.userId, b.dataset.avis === "non" ? "non" : "plus-tard:" + Date.now());
    renderAvis(); renderOffrirCarte();
  });
  $("#avis").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texte = $("#avis-texte").value.trim();
    if (texte.length < 3) return;
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    const { error } = await sb.from("temoignages").insert({
      texte, prenom: $("#avis-prenom").value.trim() || null, ville: $("#avis-ville").value.trim() || null,
      affichage_ok: $("#avis-ok").checked,
    });
    btn.disabled = false;
    if (error) { status("Le commentaire n'a pas pu être envoyé. Réessayez dans un moment."); return; }
    lsSet("avis.etat." + state.userId, "envoye");
    renderAvis();
    status("Merci! Votre commentaire est bien reçu.");
  });


  // ---------- Offrir un mois : le parrainage qui fait connaître Le Commis
  const SITE_URL = "https://lecommis.ai/";
  let parrain = null, offrirMoment = "", offrirIdee = "";
  const IDEES = [
    ["parents", "Vos parents", "Ça t'aiderait à savoir ce qu'il reste à la maison et à profiter des spéciaux."],
    ["fratrie", "Votre sœur ou votre frère", "Je pense que ça vous simplifierait l'épicerie, à vous aussi."],
    ["famille", "Une famille occupée", "Avec les enfants, ça évite les doublons et les oublis à l'épicerie."],
    ["amis", "Des amis", "On ne se demande plus qui achète quoi : tout le monde voit la même liste."],
    ["voisins", "Vos voisins", "Ça montre les spéciaux de la semaine sur ce qu'on achète vraiment."],
    ["colocs", "Des colocs", "Parfait en coloc : une liste commune, et on voit ce qui est déjà au frigo."],
    ["chalet", "Votre chalet ou votre camp", "Ça garde aussi ce qu'on a au chalet, séparément de la maison."],
  ];
  let offrirSpec = null; // spéciaux à partager (mode « spécial »)
  const b64url = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function lienParrain() {
    const q = [];
    if (parrain && parrain.code) q.push("ref=" + parrain.code);
    if (offrirSpec && offrirSpec.length) q.push("sp=" + b64url(offrirSpec.slice(0, 6).map((x) => ({ i: x.item, m: x.magasin, p: num(x.prix), r: num(x.prix_reg), f: x.fin || null }))));
    return q.length ? `${SITE_URL}?${q.join("&")}` : SITE_URL;
  }
  const ligneSpec = (x) => {
    const pr = num(x.prix), rg = num(x.prix_reg), pc = pr != null && rg ? Math.round((1 - pr / rg) * 100) : 0;
    return `${x.item} à ${money(pr)} chez ${x.magasin}${rg ? ` (au lieu de ${money(rg)}${pc >= 5 ? `, −${pc} %` : ""})` : ""}${x.fin ? `, jusqu'au ${fmtDate(x.fin)}` : ""}`;
  };
  function msgOffrir() {
    const dest = $("#offrir-prenom").value.trim();
    const moi = prenom((moiMembre() || {}).nom);
    const idee = IDEES.find((x) => x[0] === offrirIdee);
    if (offrirSpec && offrirSpec.length) {
      const un = offrirSpec.length === 1;
      return `${dest ? "Salut " + dest + "! " : ""}🔥 ${un ? "Spécial de la semaine : " + ligneSpec(offrirSpec[0]) + "." : "Spéciaux de la semaine :\n" + offrirSpec.slice(0, 6).map((x) => "• " + ligneSpec(x)).join("\n")}\nC'est Le Commis qui me trouve ces rabais chaque jeudi, sur ce qu'on achète vraiment. Essaie-le : 60 jours gratuits avec mon lien ${lienParrain()}${moi ? "\n" + moi : ""}`;
    }
    return `${dest ? "Salut " + dest + "!" : "Salut!"} J'utilise Le Commis pour l'épicerie de la maison : une liste partagée en temps réel, ce qu'on a au frigo et au garde-manger, et les spéciaux de la semaine sur ce qu'on achète. ${idee ? idee[2] + " " : ""}Avec mon lien, tu as 60 jours gratuits au lieu de 30 : ${lienParrain()}${moi ? "\n" + moi : ""}`;
  }
  function majLiensOffrir() {
    const t = $("#offrir-msg").value, e = encodeURIComponent(t);
    $("#offrir-texto").href = `sms:?&body=${e}`;
    $("#offrir-wa").href = `https://wa.me/?text=${e}`;
    $("#offrir-mail").href = `mailto:?subject=${encodeURIComponent("Un cadeau pour ton épicerie : 60 jours de Le Commis")}&body=${e}`;
    $("#offrir-lien").innerHTML = parrain && parrain.code ? `Votre lien : <b>${esc(lienParrain())}</b> · code ${esc(parrain.code)}` : "";
  }
  function renderOffrir() {
    const sc = $("#offrir-score");
    if (!parrain) sc.innerHTML = '<span class="hint">…</span>';
    else if (!parrain.amis) sc.innerHTML = `<span class="hint">Personne encore. Le premier foyer qui s'inscrit avec votre lien vous donne 1 mois gratuit.</span>`;
    else sc.innerHTML = `<b>${parrain.amis}</b> foyer${parrain.amis > 1 ? "s" : ""} inscrit${parrain.amis > 1 ? "s" : ""} avec votre lien · <b>${parrain.mois}</b> mois gagné${parrain.mois > 1 ? "s" : ""}`;
    $("#offrir-idees").innerHTML = IDEES.map(([k, l]) => `<button class="fchip" type="button" data-idee="${k}" aria-pressed="${offrirIdee === k}">${esc(l)}</button>`).join("");
    $("#offrir-partage").hidden = !navigator.share;
    $("#offrir-contacts").hidden = !("contacts" in navigator && "select" in (navigator.contacts || {}));
    $("#offrir-msg").value = msgOffrir();
    majLiensOffrir();
  }
  async function chargerParrain() {
    try { const { data, error } = await sb.rpc("mon_parrainage"); if (!error && data) parrain = data; } catch (e) {}
  }
  async function ouvrirOffrir(moment, specs) {
    offrirMoment = moment || ""; offrirSpec = specs || null;
    $("#offrir-title").textContent = specs ? (specs.length > 1 ? "Partager les spéciaux" : "Partager ce spécial") : "Offrez 60 jours gratuits à un proche";
    $("#offrir-intro").innerHTML = specs ? "Vos proches voient le rabais, et peuvent essayer Le Commis <b>60 jours gratuits</b> avec votre lien." : "Vos proches reçoivent <b>60 jours gratuits</b> pour essayer Le Commis avec votre lien.";
    fermerPanneaux("#offrir"); $("#offrir").hidden = false; renderOffrir();
    $("#offrir").scrollIntoView({ block: "start", behavior: "smooth" });
    await chargerParrain(); renderOffrir();
  }
  function notePartage(canal) {
    sb.from("partages").insert({ canal, moment: (offrirSpec ? "special:" : "") + (offrirMoment || "") || null }).then(() => {}, () => {});
    lsSet("offrir.etat." + state.userId, "partage:" + Date.now());
    renderOffrirCarte();
  }
  $("#close-offrir").addEventListener("click", () => { $("#offrir").hidden = true; });
  $("#offrir-prenom").addEventListener("input", () => { $("#offrir-msg").value = msgOffrir(); majLiensOffrir(); });
  $("#offrir-msg").addEventListener("input", majLiensOffrir);
  $("#offrir").addEventListener("click", async (e) => {
    const i = e.target.closest("[data-idee]");
    if (i) { offrirIdee = offrirIdee === i.dataset.idee ? "" : i.dataset.idee; renderOffrir(); return; }
    const b = e.target.closest("[data-canal]"); if (!b) return;
    const canal = b.dataset.canal, texte = $("#offrir-msg").value;
    if (canal === "partage") {
      e.preventDefault();
      try { await navigator.share({ title: "Le Commis", text: texte }); notePartage("partage"); } catch (err) {}
      return;
    }
    if (canal === "contacts") {
      e.preventDefault();
      try {
        const choisis = await navigator.contacts.select(["name", "tel"], { multiple: true });
        const tels = choisis.map((c) => (c.tel || [])[0]).filter(Boolean);
        if (!tels.length) return;
        if (choisis.length === 1 && !$("#offrir-prenom").value.trim() && (choisis[0].name || [])[0]) {
          $("#offrir-prenom").value = prenom(choisis[0].name[0]); $("#offrir-msg").value = msgOffrir(); majLiensOffrir();
        }
        notePartage("contacts");
        location.href = `sms:${tels.map((t) => t.replace(/[^\d+]/g, "")).join(",")}?&body=${encodeURIComponent($("#offrir-msg").value)}`;
      } catch (err) {}
      return;
    }
    if (canal === "copie") {
      try { await navigator.clipboard.writeText(texte); status("Message et lien copiés. Collez-les où vous voulez : texto, Messenger, courriel…"); notePartage("copie"); }
      catch (err) { status("Copie impossible ici : sélectionnez le message à la main."); }
      return;
    }
    notePartage(canal); // texto, whatsapp, courriel : le lien s'ouvre normalement
  });
  // Partager un spécial : d'un geste sur téléphone, sinon le panneau avec texto, WhatsApp, courriel
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-spshare]"); if (!b) return;
    const vis = state.spec.filter((x) => !x.ignore);
    const specs = b.dataset.spshare === "tous" ? vis : vis.filter((x) => x.id === b.dataset.spshare);
    if (!specs.length) return;
    if (!parrain) await chargerParrain();
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      offrirSpec = specs; offrirMoment = "speciaux";
      const texte = (() => { const v = $("#offrir-prenom").value; $("#offrir-prenom").value = ""; const t = msgOffrir(); $("#offrir-prenom").value = v; return t; })();
      try { await navigator.share({ title: "Spéciaux de la semaine", text: texte }); notePartage("partage"); status("Partagé!"); }
      catch (err) { if (err && err.name !== "AbortError") ouvrirOffrir("speciaux", specs); }
      offrirSpec = null;
      return;
    }
    ouvrirOffrir("speciaux", specs);
  });
  document.addEventListener("click", (e) => { const o = e.target.closest("[data-offrir]"); if (o && !o.closest("#offrir")) ouvrirOffrir(o.dataset.offrir); });

  // Une carte « Offrir un mois » aux bons moments : après des économies, ou après quelques jours d'usage
  function offrirAMontrer() {
    if (!state.userId || $("#avis").innerHTML || $("#retour-carte").innerHTML) return null;
    const etat = lsGet("offrir.etat." + state.userId) || "";
    if (etat === "non") return null;
    const [k, t] = etat.split(":"), quand = Number(t || 0);
    if (k === "plus-tard" && Date.now() < quand + 10 * JOUR) return null;
    if (k === "partage" && Date.now() < quand + 30 * JOUR) return null;
    const mois = today().slice(0, 7);
    const eco = (state.eco || []).filter((x) => String(x.date_achat || "").startsWith(mois)).reduce((s, x) => s + (num(x.montant) || 0), 0);
    if (eco >= 5) return { eco };
    if (state.userCreated && Date.now() - new Date(state.userCreated).getTime() >= 5 * JOUR) return { eco: 0 };
    return null;
  }
  function renderOffrirCarte() {
    const box = $("#offrir-carte"); if (!box) return;
    const m = offrirAMontrer();
    if (!m) { box.innerHTML = ""; return; }
    box.innerHTML = `<section class="offrir-carte">
      <div class="offrir-carte-txt"><b>${m.eco ? `Vous avez économisé ${money(m.eco)} ce mois-ci. Qui d'autre aimerait ça?` : "Le Commis vous simplifie l'épicerie? Qui d'autre aimerait ça?"}</b>
        <span class="hint">Offrez 60 jours gratuits à un proche.</span></div>
      <div class="row-actions"><button class="btn" type="button" data-offrir="${m.eco ? "economies" : "carte"}">🎁 Offrir 60 jours</button>
        <button class="link" type="button" data-offrir-carte="plus-tard">Plus tard</button><button class="link muted" type="button" data-offrir-carte="non">Non merci</button></div>
    </section>`;
  }
  $("#offrir-carte").addEventListener("click", (e) => {
    const b = e.target.closest("[data-offrir-carte]"); if (!b) return;
    lsSet("offrir.etat." + state.userId, b.dataset.offrirCarte === "non" ? "non" : "plus-tard:" + Date.now());
    renderOffrirCarte();
  });


  // ---------- Boucle de retour : idées → équipe → réponse et nouveautés dans l'app
  const retour = { idees: [], nouveautes: [], sondageDernier: null, charge: false };
  let ideeType = "idee";
  const STATUT_IDEE = { recue: ["Reçue", ""], etudiee: ["À l'étude", "etude"], prevue: ["Prévue", "prevue"], faite: ["Faite ✓", "faite"], non: ["Pas pour l'instant", "non"] };
  const TYPE_IDEE = { idee: "💡", probleme: "🐞", aime: "❤️", autre: "💬" };
  function vuRetour() { try { return JSON.parse(lsGet("retour.vu." + state.userId) || "{}"); } catch (e) { return {}; } }
  function noterVu(maj) { lsSet("retour.vu." + state.userId, JSON.stringify({ ...vuRetour(), ...maj })); }
  const cleIdee = (i) => i.statut + "|" + (i.repondu || "");
  async function chargerRetour() {
    if (!state.userId) return;
    const [a, b, c] = await Promise.all([
      sb.from("idees").select("id, cree, type, texte, statut, reponse, repondu").order("cree", { ascending: false }).limit(50),
      sb.from("nouveautes").select("id, cree, titre, texte").order("cree", { ascending: false }).limit(10),
      sb.from("sondages").select("cree").order("cree", { ascending: false }).limit(1),
    ]);
    retour.idees = (a && a.data) || []; retour.nouveautes = (b && b.data) || [];
    retour.sondageDernier = c && c.data && c.data[0] ? c.data[0].cree : null; retour.charge = true;
    renderRetourCarte(); renderAvis(); renderOffrirCarte();
    if (!$("#idee").hidden) renderMiennes();
  }
  function renderMiennes() {
    const l = retour.idees;
    $("#idee-miennes").innerHTML = l.length ? `<h3 class="offrir-h">Vos envois</h3><ul class="idee-liste">${l.map((i) => {
      const [mot, cls] = STATUT_IDEE[i.statut] || STATUT_IDEE.recue;
      return `<li><div class="idee-tete"><span>${TYPE_IDEE[i.type] || "💬"} ${esc(new Date(i.cree).toLocaleDateString("fr-CA", { day: "numeric", month: "short" }))}</span><span class="idee-statut ${cls}">${esc(mot)}</span></div>
        <p>${esc(i.texte)}</p>${i.reponse ? `<p class="idee-rep"><b>Réponse de l'équipe :</b> ${esc(i.reponse)}</p>` : ""}</li>`;
    }).join("")}</ul>` : "";
    // Ouvrir la liste vaut lecture des réponses
    const vu = vuRetour().idees || {}; l.forEach((i) => { vu[i.id] = cleIdee(i); }); noterVu({ idees: vu });
  }
  function ouvrirIdee(type, texte) {
    fermerPanneaux("#idee"); $("#idee").hidden = false;
    if (type) { ideeType = type; document.querySelectorAll("[data-itype]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.itype === ideeType))); }
    if (texte) $("#idee-texte").value = texte;
    renderMiennes(); renderRetourCarte();
    $("#idee").scrollIntoView({ block: "start", behavior: "smooth" });
    setTimeout(() => focusIfDesktop($("#idee-texte")), 80);
  }
  const PLACE = { idee: "Ce serait pratique si…", probleme: "Qu'est-ce qui accroche? Sur quel écran?", aime: "Ce que vous aimez le plus…", autre: "Votre message…" };
  $("#open-idee").addEventListener("click", () => ($("#idee").hidden ? ouvrirIdee() : ($("#idee").hidden = true)));
  $("#close-idee").addEventListener("click", () => { $("#idee").hidden = true; });
  $("#f-idee").addEventListener("click", (e) => {
    const b = e.target.closest("[data-itype]"); if (!b) return;
    ideeType = b.dataset.itype;
    document.querySelectorAll("[data-itype]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#idee-texte").placeholder = PLACE[ideeType];
  });
  async function envoyerIdee({ type, texte, contact, source }) {
    const me = moiMembre() || {};
    return sb.from("idees").insert({ type, texte, contact_ok: !!contact, source: source || "app", prenom: prenom(me.nom) || null,
      ecran: (ECRANS[view] || view || "").slice(0, 40), appareil: navigator.userAgent.slice(0, 200) });
  }
  $("#f-idee").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texte = $("#idee-texte").value.trim(); if (texte.length < 2) return;
    $("#idee-envoyer").disabled = true;
    const { error } = await envoyerIdee({ type: ideeType, texte, contact: $("#idee-contact").checked });
    $("#idee-envoyer").disabled = false;
    if (error) { status("Le message n'a pas pu être envoyé. Vérifiez votre connexion et réessayez."); return; }
    $("#idee-texte").value = ""; $("#idee-contact").checked = false;
    status(ideeType === "aime" ? "Merci! Ça fait vraiment plaisir à l'équipe." : "Merci! C'est bien reçu. Vous verrez notre réponse ici.");
    chargerRetour();
  });

  // Une seule carte à la fois en haut de l'app : réponse reçue, nouveauté, puis sondage éclair
  let sondage = null; // { note } pendant la 2e étape
  function carteRetour() {
    if (!retour.charge || !state.userId) return null;
    const vu = vuRetour(), vuI = vu.idees || {};
    const rep = retour.idees.find((i) => (i.reponse || ["prevue", "faite", "non"].includes(i.statut)) && vuI[i.id] !== cleIdee(i));
    if (rep) return { k: "reponse", i: rep };
    const depuis = Math.max(new Date(state.userCreated || 0).getTime(), Number(vu.nv || 0));
    const nv = retour.nouveautes.find((n) => new Date(n.cree).getTime() > depuis);
    if (nv) return { k: "nouveaute", n: nv };
    if (sondage) return { k: "sondage" };
    const age = Date.now() - new Date(state.userCreated || Date.now()).getTime();
    const dernier = Math.max(new Date(retour.sondageDernier || 0).getTime(), Number(vu.sondage || 0));
    if (age >= 10 * JOUR && Date.now() - dernier >= 90 * JOUR && Date.now() - Number(vu.sondagePlusTard || 0) >= 14 * JOUR) return { k: "sondage" };
    return null;
  }
  function renderRetourCarte() {
    const box = $("#retour-carte"); if (!box) return;
    const c = carteRetour();
    if (!c) { box.innerHTML = ""; return; }
    if (c.k === "reponse") {
      const i = c.i, [mot] = STATUT_IDEE[i.statut] || STATUT_IDEE.recue;
      box.innerHTML = `<section class="retour-carte"><b>${i.statut === "faite" ? "🎉 Votre idée est en ligne!" : "💬 L'équipe vous a répondu"}</b>
        <p class="hint">Vous avez écrit : « ${esc(i.texte.length > 140 ? i.texte.slice(0, 140) + "…" : i.texte)} » · <b>${esc(mot)}</b></p>
        ${i.reponse ? `<p>${esc(i.reponse)}</p>` : ""}
        <div class="row-actions"><button class="btn" type="button" data-retour="vu-idee" data-id="${i.id}">Merci!</button><button class="link" type="button" data-retour="idee">Voir mes envois</button></div></section>`;
    } else if (c.k === "nouveaute") {
      const n = c.n;
      box.innerHTML = `<section class="retour-carte"><b>✨ Nouveau : ${esc(n.titre)}</b>${n.texte ? `<p>${esc(n.texte)}</p>` : ""}
        <div class="row-actions"><button class="btn" type="button" data-retour="vu-nv" data-t="${new Date(n.cree).getTime()}">Super</button><button class="link" type="button" data-retour="idee">Proposer une idée</button></div></section>`;
    } else if (!sondage) {
      box.innerHTML = `<section class="retour-carte"><b>Recommanderiez-vous Le Commis à un proche?</b>
        <p class="hint">0 = pas du tout, 10 = sans hésiter. Une seule question.</p>
        <div class="nps" role="group" aria-label="Note de 0 à 10">${Array.from({ length: 11 }, (_, n) => `<button type="button" class="nps-n" data-note="${n}">${n}</button>`).join("")}</div>
        <div class="row-actions"><button class="link muted" type="button" data-retour="sondage-plus-tard">Plus tard</button></div></section>`;
    } else {
      const n = sondage.note;
      const q = n >= 9 ? "Merci! Qu'est-ce que vous aimez le plus?" : n >= 7 ? "Merci! Qu'est-ce qui le rendrait parfait pour vous?" : "Merci de votre franchise. Qu'est-ce qui accroche le plus?";
      box.innerHTML = `<section class="retour-carte"><b>${esc(q)}</b>
        <textarea id="sondage-raison" rows="3" maxlength="2000" placeholder="Facultatif, mais ça nous aide beaucoup"></textarea>
        <div class="row-actions"><button class="btn" type="button" data-retour="sondage-envoyer">Envoyer</button><button class="link muted" type="button" data-retour="sondage-passer">Passer</button></div></section>`;
    }
  }
  async function finirSondage(raison) {
    const n = sondage.note; sondage = null;
    noterVu({ sondage: Date.now() });
    await sb.from("sondages").insert({ note: n, raison: raison || null }).then(() => {}, () => {});
    if (raison) envoyerIdee({ type: n >= 9 ? "aime" : n <= 6 ? "probleme" : "idee", texte: raison, source: "sondage" }).then(() => {}, () => {});
    renderRetourCarte();
    if (n >= 9) status("Merci! Ça nous fait vraiment plaisir.");
    else status("Merci! Votre réponse est bien reçue. L'équipe la lit.");
  }
  $("#retour-carte").addEventListener("click", async (e) => {
    const nb = e.target.closest("[data-note]");
    if (nb) { sondage = { note: Number(nb.dataset.note) }; renderRetourCarte(); setTimeout(() => focusIfDesktop($("#sondage-raison")), 50); return; }
    const b = e.target.closest("[data-retour]"); if (!b) return;
    const g = b.dataset.retour;
    if (g === "vu-idee") { const i = retour.idees.find((x) => x.id === b.dataset.id); const vu = vuRetour().idees || {}; if (i) vu[i.id] = cleIdee(i); noterVu({ idees: vu }); }
    else if (g === "vu-nv") noterVu({ nv: Number(b.dataset.t) });
    else if (g === "idee") { ouvrirIdee(); return; }
    else if (g === "sondage-plus-tard") noterVu({ sondagePlusTard: Date.now() });
    else if (g === "sondage-envoyer") return finirSondage(($("#sondage-raison").value || "").trim());
    else if (g === "sondage-passer") return finirSondage("");
    renderRetourCarte(); renderAvis(); renderOffrirCarte();
  });

  // ---------- le Commis : l'agent qui répond aux questions
  const ECRANS = { produits: "Produits", maison: "Espace", liste: "Liste épicerie", speciaux: "Spéciaux", membres: "Membres", rappel: "Rappel du soir", bilan: "Bilan du soir", facture: "Lire une facture", ecran: "Écran d'accueil", guide: "Guide complet", idee: "Une idée?" };
  const commis = { msgs: [], busy: false };
  function allerA(k) {
    $("#commis").hidden = true;
    if (["produits", "maison", "liste", "speciaux"].includes(k)) { showView(k); window.scrollTo({ top: 0, behavior: "smooth" }); }
    else if (k === "membres") showMembres(true);
    else if (k === "rappel") showRappel(true);
    else if (k === "bilan") ouvrirBilan();
    else if (k === "idee") ouvrirIdee();
    else if (k === "facture") { showView("produits"); $("#in-facture").click(); }
    else if (k === "ecran") montrerEcran();
    else if (k === "guide") showHelp(true);
  }
  function msgHtml(m) {
    let t = String(m.content || ""), go = null;
    t = t.replace(/\[\[ecran:([a-z]+)\]\]/g, (x, k) => { if (ECRANS[k]) go = k; return ""; }).trim();
    const html = esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
    return `<div class="cad-msg ${m.role === "assistant" ? "bot" : "me"}">${html}${go && m.role === "assistant" ? `<button class="btn small cad-go" type="button" data-cadgo="${go}">Aller à : ${ECRANS[go]}</button>` : ""}</div>`;
  }
  function renderCommis() {
    const av = $("#commis-av"); if (av && window.CommisGuide && !av.dataset.ok) { av.innerHTML = CommisGuide.avatar(); av.dataset.ok = "1"; }
    const bv = $("#voix-commis"); if (bv && window.CommisGuide && CommisGuide.peutParler) { bv.hidden = false; CommisGuide.majBoutonVoix(bv); }
    const nom = prenom((moiMembre() || {}).nom);
    if (!commis.msgs.length) commis.msgs.push({ role: "assistant", content: `Bonjour${nom ? " " + nom : ""} ! Moi, c'est Rosalie, votre commis. Posez-moi vos questions sur l'app : ajouter un produit, ranger la maison, la liste, les spéciaux…` });
    $("#commis-log").innerHTML = commis.msgs.map(msgHtml).join("") + (commis.busy ? '<div class="cad-msg bot busy">…</div>' : "");
    const sugg = ["Comment ajouter un produit avec la photo ?", "Comment ranger ce que j'ai acheté ?", "Comment marche le bilan du soir ?", "Comment inviter quelqu'un ?"];
    $("#commis-sugg").innerHTML = commis.msgs.length < 2 ? sugg.map((q) => `<button class="fchip" type="button" data-cadq="${esc(q)}">${esc(q)}</button>`).join("") : "";
    $("#in-commis").disabled = commis.busy; $("#btn-commis").disabled = commis.busy;
    const log = $("#commis-log"); log.scrollTop = log.scrollHeight;
  }
  function ouvrirCommis() {
    fermerPanneaux("#commis"); $("#commis").hidden = false; renderCommis();
    $("#commis").scrollIntoView({ block: "start", behavior: "smooth" });
    setTimeout(() => focusIfDesktop($("#in-commis")), 80);
  }
  async function demanderCommis(q) {
    commis.msgs.push({ role: "user", content: q }); commis.busy = true; renderCommis();
    const me = moiMembre() || {};
    const contexte = { prenom: prenom(me.nom), nouveau: !lsGet("demarrer.masque." + state.userId) && etapesDemarrer().filter((x) => x.done).length < 3,
      produits: state.prod.length, maison: state.prod.filter((p) => Number(p.stock || 0) > 0).length, liste: state.liste.filter((i) => !i.fait).length,
      surveilles: state.prod.filter((p) => p.surveiller).length, rappel: rappelActif, forfait: etatForfait().type, proprio: estProprio(), installee: installee(), onglet: ECRANS[view] || view };
    try {
      const { data, error } = await sb.functions.invoke("commis", { body: { messages: commis.msgs.slice(1), contexte } });
      commis.msgs.push({ role: "assistant", content: !error && data && data.text ? data.text : "Je n'ai pas pu répondre pour l'instant. Réessayez dans un moment, ou consultez le guide complet. [[ecran:guide]]" });
      const posee = [...commis.msgs].reverse().find((m) => m.role === "user");
      if (!error && data && data.text && posee) sb.from("console_questions").insert({ app: "commis", question: String(posee.content).slice(0, 2000), reponse: String(data.text).slice(0, 4000), contexte: String(contexte.onglet || "").slice(0, 200) }).then(() => {}, () => {});
    } catch (e) { commis.msgs.push({ role: "assistant", content: "Pas de réseau pour l'instant. Réessayez dans un moment." }); }
    commis.busy = false; renderCommis();
    const dern = commis.msgs[commis.msgs.length - 1];
    if (window.CommisGuide && dern && dern.role === "assistant" && !$("#commis").hidden) CommisGuide.parler(dern.content, $("#commis-av"));
    if (!desktop) $("#in-commis").blur();
  }
  $("#open-commis").addEventListener("click", () => ($("#commis").hidden ? ouvrirCommis() : ($("#commis").hidden = true)));
  $("#close-commis").addEventListener("click", () => { $("#commis").hidden = true; if (window.CommisGuide) CommisGuide.taireVoix(); });
  $("#voix-commis").addEventListener("click", () => {
    const on = !CommisGuide.voixActive(); CommisGuide.activerVoix(on);
    const dern = [...commis.msgs].reverse().find((m) => m.role === "assistant");
    if (on && dern) CommisGuide.parler(dern.content, $("#commis-av"));
  });
  $("#f-commis").addEventListener("submit", (e) => { e.preventDefault(); const q = $("#in-commis").value.trim(); if (!q || commis.busy) return; $("#in-commis").value = ""; demanderCommis(q); });
  $("#commis").addEventListener("click", (e) => {
    const g = e.target.closest("[data-cadgo]"); if (g) return allerA(g.dataset.cadgo);
    const q = e.target.closest("[data-cadq]"); if (q && !commis.busy) demanderCommis(q.dataset.cadq);
  });

  // ---------- suggestions (seulement pendant la saisie)
  const desktop = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
  const focusIfDesktop = (el) => { if (desktop) el.focus(); };
  function setupSuggest(inputSel, boxSel) {
    const input = $(inputSel), box = $(boxSel);
    let shown = [], active = -1;
    const hide = () => { box.hidden = true; box.innerHTML = ""; shown = []; active = -1; };
    const pick = (p) => { input.value = p.nom; hide(); input.dispatchEvent(new Event("input")); hide(); };
    function update() {
      const q = norm(input.value);
      if (q.length < 2 || document.activeElement !== input) return hide();
      const words = q.split(" ");
      shown = state.prod
        .filter((p) => { const n = norm([p.nom, p.marque].join(" ")); return words.every((w) => n.includes(w)) && norm(p.nom) !== q; })
        .sort((a, b) => (norm(b.nom).startsWith(q) - norm(a.nom).startsWith(q)) || norm(a.nom).localeCompare(norm(b.nom)))
        .slice(0, 5);
      if (!shown.length) return hide();
      active = -1;
      box.innerHTML = shown.map((p, i) => `<li role="option" id="${boxSel.slice(1)}-${i}" data-i="${i}">${thumb(p.photo, "")}<span>${esc(p.nom)}${p.format ? ` <span class="meta">${esc(p.format)}</span>` : ""}</span></li>`).join("");
      box.hidden = false;
    }
    input.addEventListener("input", update);
    input.addEventListener("blur", () => setTimeout(hide, 150));
    input.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
        box.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(shown[active]); }
      else if (e.key === "Escape") hide();
    });
    box.addEventListener("pointerdown", (e) => {
      const li = e.target.closest("li[data-i]"); if (!li) return;
      e.preventDefault(); pick(shown[+li.dataset.i]);
    });
    input.form && input.form.addEventListener("submit", hide);
  }
  setupSuggest("#in-liste", "#sug-liste");
  $("#in-msearch").addEventListener("input", renderMaison);
  $("#f-espace").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-espace").value.trim(); if (!nom) return;
    if (state.espaces.some((x) => norm(x.nom) === norm(nom))) { status(`L'espace « ${nom} » existe déjà.`); return; }
    $("#in-espace").value = "";
    const ordre = Math.max(0, ...state.espaces.map((x) => x.ordre || 0)) + 1;
    if (await run(sb.from("espaces").insert({ nom, ordre, lieu_id: idLieu() }), `Espace « ${nom} » créé à « ${nomLieu()} ».`)) scheduleReload("espaces");
  });

  // ---------- ajout par photo
  let photoPending = null; // {path, ident, busy}
  function showPending(p) {
    photoPending = p;
    $("#pending").hidden = !p;
    if (!p) return;
    $("#pending-img").src = p.preview || "";
    const id = p.ident;
    $("#pending-title").textContent = p.busy ? "Identification du produit…" : (id && id.nom) ? id.nom : "Produit non reconnu";
    $("#pending-meta").textContent = p.busy ? "La photo sera jointe à l'article."
      : p.erreur ? p.erreur
      : (id && id.nom) ? [id.marque, id.format, id.categorie].filter(Boolean).join(" · ") + (id.confiance === "basse" ? " · à vérifier" : "")
      : "Écrivez le nom de l'article; la photo y sera jointe.";
    updatePendingAdd();
  }
  function updatePendingAdd() {
    const btn = $("#pending-add");
    if (!photoPending) return;
    const nom = $("#in-liste").value.trim();
    btn.disabled = photoPending.busy || !nom;
    btn.textContent = photoPending.busy ? "Identification…" : nom ? `Ajouter « ${nom} »` : "Écrivez le nom ci-dessus";
  }
  $("#in-liste").addEventListener("input", updatePendingAdd);
  $("#pending-add").addEventListener("click", () => $("#f-liste").requestSubmit());
  $("#in-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    const preview = URL.createObjectURL(file);
    showPending({ preview, busy: true });
    const mine = photoPending;
    try {
      const { blob, b64 } = await shrink(file);
      const [path, ident] = await Promise.all([
        uploadPhoto(blob),
        sb.functions.invoke("identifier-produit", { body: { image: b64, media_type: "image/jpeg" } })
          .then(({ data, error }) => (error ? { erreur: true } : data)).catch(() => ({ erreur: true })),
      ]);
      if (photoPending !== mine) return; // annulé entre-temps
      const ok = ident && !ident.erreur && ident.nom;
      if (ok && !$("#in-liste").value.trim()) $("#in-liste").value = ident.nom;
      showPending({ preview, path, ident: ok ? ident : null, busy: false,
        erreur: ident && ident.erreur ? "L'identification n'a pas fonctionné. Écrivez le nom; la photo y sera jointe." : "" });
      if (ok) focusIfDesktop($("#pending-add")); else focusIfDesktop($("#in-liste"));
    } catch (err) {
      console.error(err);
      if (photoPending === mine) showPending(null);
      status("La photo n'a pas pu être envoyée. Vérifiez votre connexion et réessayez.");
    }
  });
  $("#pending-cancel").addEventListener("click", () => {
    if (photoPending && photoPending.path) sb.storage.from("photos").remove([photoPending.path]);
    if (photoPending && photoPending.ident && $("#in-liste").value.trim() === photoPending.ident.nom) $("#in-liste").value = "";
    showPending(null);
  });

  // Photo d'un produit du catalogue
  let prodPhotoTarget = null;
  $("#in-prod-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file || !prodPhotoTarget) return;
    const id = prodPhotoTarget; prodPhotoTarget = null;
    status("Envoi de la photo…");
    try {
      const { blob } = await shrink(file);
      const path = await uploadPhoto(blob);
      if (await run(sb.from("produits").update({ photo: path }).eq("id", id), "Photo ajoutée.")) scheduleReload("produits");
    } catch (err) { console.error(err); status("La photo n'a pas pu être envoyée. Vérifiez votre connexion et réessayez."); }
  });

  // Agrandir une photo
  function zoom(path) {
    const u = urls.get(path); if (!u) return;
    $("#lightbox-img").src = u; $("#lightbox").hidden = false; $("#lightbox-close").focus();
  }
  $("#lightbox").addEventListener("click", () => { $("#lightbox").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });
  // Optimistic local update, then sync
  function local(table, fn) { fn(); render(); }

  // ---------- events
  $("#f-liste").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-liste").value.trim(); if (!nom) return;
    if (photoPending && photoPending.busy) { status("Un instant, la photo est en cours d'envoi."); return; }
    const qte = $("#in-qte").value.trim();
    const ph = photoPending && photoPending.path ? photoPending.path : null;
    const id = (photoPending && photoPending.ident) || {};
    const sameAsIdent = id.nom && norm(id.nom) === norm(nom);
    $("#in-liste").value = ""; $("#in-qte").value = ""; focusIfDesktop($("#in-liste"));
    showPending(null);
    if (await run(sb.from("epicerie").insert(ph ? { nom, qte, photo: ph, liste_id: idListeActive() } : { nom, qte, liste_id: idListeActive() }))) {
      scheduleReload("epicerie");
      ensureProduct(nom, ph ? { photo: ph, ...(sameAsIdent ? { marque: id.marque, format: id.format, categorie: id.categorie } : {}) } : null);
    }
  });
  $("#f-store").addEventListener("submit", async (e) => {
    e.preventDefault(); const m = $("#in-store").value.trim(); if (!m) return;
    const cur = stores(); $("#in-store").value = "";
    if (cur.some((x) => norm(x) === norm(m))) return;
    await majMagasins([...cur, m]);
  });
  // Catalogue : ajout avec la caméra
  let catPhoto = null; // {preview, path, ident, busy}
  function showCatPhoto(p) {
    catPhoto = p; $("#ppending").hidden = !p; if (!p) return;
    $("#ppending-img").src = p.preview || "";
    const id = p.ident;
    $("#ppending-title").textContent = p.busy ? "Identification du produit…" : (id && id.nom) ? id.nom : "Produit non reconnu";
    $("#ppending-meta").textContent = p.busy ? "La photo sera jointe au produit."
      : p.erreur ? p.erreur
      : (id && id.nom) ? [id.marque, id.format, id.categorie].filter(Boolean).join(" · ") + (id.confiance === "basse" ? " · à vérifier" : "")
      : "Écrivez le nom du produit; la photo y sera jointe.";
    majCatBtn();
  }
  function majCatBtn() {
    majAjoutRapide();
    if (!catPhoto) return;
    const nom = $("#in-pnom").value.trim(), b = $("#ppending-add");
    b.disabled = catPhoto.busy || !nom;
    b.textContent = catPhoto.busy ? "Identification…" : nom ? `Ajouter « ${nom} » aux produits` : "Écrivez le nom ci-dessus";
  }
  $("#in-pnom").addEventListener("input", (e) => { search = separerFormat(e.target.value).nom || e.target.value; renderProducts(); majCatBtn(); });
  $("#ppending-add").addEventListener("click", () => ajouterProduit(false));
  $("#ppending-cancel").addEventListener("click", () => {
    if (catPhoto && catPhoto.path) sb.storage.from("photos").remove([catPhoto.path]);
    if (catPhoto && catPhoto.ident && separerFormat($("#in-pnom").value).nom === catPhoto.ident.nom) { $("#in-pnom").value = ""; search = ""; }
    showCatPhoto(null);
  });
  $("#in-pphoto").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file) return;
    const preview = URL.createObjectURL(file);
    showCatPhoto({ preview, busy: true }); const mine = catPhoto;
    try {
      const { blob, b64 } = await shrink(file);
      const [path, ident] = await Promise.all([
        uploadPhoto(blob),
        sb.functions.invoke("identifier-produit", { body: { image: b64, media_type: "image/jpeg" } })
          .then(({ data, error }) => (error ? { erreur: true } : data)).catch(() => ({ erreur: true })),
      ]);
      if (catPhoto !== mine) return;
      const ok = ident && !ident.erreur && ident.nom;
      if (ok) {
        if (!$("#in-pnom").value.trim()) $("#in-pnom").value = ident.nom + (ident.format ? " " + ident.format : "");
      }
      showCatPhoto({ preview, path, ident: ok ? ident : null, busy: false,
        erreur: ident && ident.erreur ? "L'identification n'a pas fonctionné. Écrivez le nom; la photo y sera jointe." : "" });
      if (ok) focusIfDesktop($("#ppending-add")); else focusIfDesktop($("#in-pnom"));
    } catch (err) {
      console.error(err);
      if (catPhoto === mine) showCatPhoto(null);
      status("La photo n'a pas pu être envoyée. Vérifiez votre connexion et réessayez.");
    }
  });

  function viderAjout() { $("#in-pnom").value = ""; search = ""; showCatPhoto(null); renderProducts(); majAjoutRapide(); }
  // Sous le champ : « ＋ Ajouter » quand le produit n'existe pas encore ici
  function majAjoutRapide() {
    const box = $("#ajout-rapide"); if (!box) return;
    const brut = $("#in-pnom").value.trim(), { nom, format } = separerFormat(brut);
    const ici = nom && prodLieu().find((p) => norm(p.nom) === norm(nom));
    $("#pnom-aide").hidden = !!brut;
    if (!nom || ici) { box.hidden = true; box.innerHTML = ""; return; }
    const id = catPhoto && catPhoto.ident && norm(catPhoto.ident.nom) === norm(nom) ? catPhoto.ident : null;
    const cat = id && CATS.includes(id.categorie) ? id.categorie : devinerCategorie(nom);
    box.hidden = false;
    box.innerHTML = `<button class="btn" type="button" data-ajoutrapide="">＋ Ajouter « ${esc(nom)} »</button>
      <button class="btn ghost" type="button" data-ajoutrapide="liste">＋ Ajouter et 🛒</button>
      <p class="hint">${format || (id && id.format) ? `Format : <b>${esc(format || id.format)}</b> · ` : ""}Catégorie : <b>${esc(cat)}</b></p>`;
  }
  async function ajouterProduit(versListe) {
    const brut = $("#in-pnom").value.trim(); if (!brut) return;
    if (catPhoto && catPhoto.busy) { status("Un instant, la photo est en cours d'envoi."); return; }
    const { nom, format } = separerFormat(brut); if (!nom) return;
    const ph = catPhoto && catPhoto.path, id = (catPhoto && catPhoto.ident) || {};
    const memeId = id.nom && norm(id.nom) === norm(nom);
    const existant = state.prod.find((p) => norm(p.nom) === norm(nom));
    const versLaListe = async (p) => {
      if (!versListe || !p || dansListeLieu(p)) return "";
      const l = listeDe(p);
      if (await run(sb.from("epicerie").insert({ nom: p.nom, liste_id: l }))) { scheduleReload("epicerie"); return ` et à « ${nomListe(l)} »`; }
      return "";
    };
    if (existant) {
      const ailleurs = !dansLieu(existant);
      if (ailleurs) await ajouterAuLieu(existant);
      if (ph && !existant.photo) await run(sb.from("produits").update({ photo: ph }).eq("id", existant.id));
      const l = await versLaListe(existant);
      status(ailleurs ? `« ${existant.nom} » ajouté aux produits de « ${nomLieu()} »${l}.` : l ? `« ${existant.nom} » ajouté${l.replace(" et", "")}.` : `« ${existant.nom} » est déjà dans vos produits.`);
      viderAjout(); scheduleReload("produits"); render(); return;
    }
    const row = { nom, format: format || (memeId && id.format) || "", categorie: memeId && CATS.includes(id.categorie) ? id.categorie : devinerCategorie(nom), lieux: [idLieu()].filter(Boolean) };
    if (ph) { row.photo = ph; if (id.marque && memeId) row.marque = id.marque; }
    viderAjout(); focusIfDesktop($("#in-pnom"));
    const { data, error } = await sb.from("produits").insert(row).select("*").single();
    if (error) { console.error(error); status("Le produit n'a pas pu être ajouté. Vérifiez votre connexion et réessayez."); return; }
    if (data) { state.prod.push(data); render(); }
    const l = await versLaListe(data || row);
    status(`« ${nom} » ajouté à vos produits${l} · ${row.categorie}. Touchez-le pour changer la catégorie ou le format.`);
    scheduleReload("produits");
  }
  $("#f-prod").addEventListener("submit", (e) => { e.preventDefault(); ajouterProduit(false); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-ajoutrapide]"); if (b) ajouterProduit(b.dataset.ajoutrapide === "liste"); });

  document.addEventListener("change", async (e) => {
    const c = e.target.closest("#app .check");
    if (c) {
      const it = state.liste.find((i) => i.id === c.dataset.id);
      if (it) local("epicerie", () => (it.fait = c.checked));
      await run(sb.from("epicerie").update({ fait: c.checked }).eq("id", c.dataset.id));
      // Acheté : on range dans la réserve de la maison (si le produit a un espace)
      const p = it && state.prod.find((x) => norm(x.nom) === norm(it.nom));
      if (p && p.espace_id) { const q = num(it.qte); await ajusterStock(p.id, (c.checked ? 1 : -1) * (q && q > 0 ? q : 1)); }
      return;
    }
    const df = e.target.closest("[data-dfield]");
    if (df) {
      const v = df.value || null; const p = state.prod.find((x) => x.id === df.dataset.id); if (p) p.peremption = v;
      if (await majInv(df.dataset.id, { peremption: v }) && v) status("Date de péremption enregistrée.");
      render(); return;
    }
    const pn = e.target.closest("[data-pan]");
    if (pn) {
      const f = pn.dataset.pan, raw = pn.value.trim();
      const v = f === "quantite" ? (num(raw) || 1) : (raw || null);
      if (f === "nom" && !v) return;
      const r = state.panier.find((x) => x.id === pn.dataset.id); if (r) r[f] = v;
      await run(sb.from("panier").update({ [f]: v }).eq("id", pn.dataset.id));
      return;
    }
    const nf = e.target.closest("[data-nfield]");
    if (nf) {
      const raw = nf.value.trim(), v = num(raw);
      if (raw !== "" && v == null) { status("Inscris un nombre, par exemple 2."); return; }
      if (nf.dataset.nfield === "minimum") { const p = state.prod.find((x) => x.id === nf.dataset.id); if (p) p.minimum = raw === "" ? null : v; await majInv(nf.dataset.id, { minimum: raw === "" ? null : v }); render(); return; }
      await run(sb.from("produits").update({ [nf.dataset.nfield]: raw === "" ? null : v }).eq("id", nf.dataset.id));
      scheduleReload("produits"); return;
    }
    const en = e.target.closest("[data-espnom]");
    if (en) {
      const v = en.value.trim(); if (!v) return;
      await run(sb.from("espaces").update({ nom: v }).eq("id", en.dataset.espnom));
      scheduleReload("espaces"); return;
    }
    const pf = e.target.closest("[data-pfield]");
    if (pf) {
      let v = pf.value.trim(); if (pf.dataset.pfield === "nom" && !v) return;
      if (pf.dataset.pfield === "espace_id" || pf.dataset.pfield === "liste_id") v = v || null;
      if (pf.dataset.pfield === "espace_id") { const p = state.prod.find((x) => x.id === pf.dataset.id); if (p) p.espace_id = v; await majInv(pf.dataset.id, { espace_id: v }); render(); return; }
      await run(sb.from("produits").update({ [pf.dataset.pfield]: v }).eq("id", pf.dataset.id));
      scheduleReload("produits"); return;
    }
    const pi = e.target.closest("[data-price]");
    if (pi) {
      const v = num(pi.value);
      if (pi.value.trim() !== "" && v == null) { status("Inscris un prix en chiffres, par exemple 4,99."); return; }
      await run(sb.rpc("maj_prix", { p_id: pi.dataset.id, p_magasin: pi.dataset.price, p_entree: { reg: v, maj: today(), par: "manuel" } }));
      scheduleReload("produits");
    }
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#app")) return;
    const z = e.target.closest("[data-zoom]");
    if (z) { e.preventDefault(); zoom(z.dataset.zoom); return; }
    const dop = e.target.closest("[data-dateopen]");
    if (dop) { dateOpen = dateOpen === dop.dataset.dateopen ? null : dop.dataset.dateopen; moveOpen = null; delOpen = null; renderMaison(); return; }
    const dcl = e.target.closest("[data-dateclear]");
    if (dcl) { const p = state.prod.find((x) => x.id === dcl.dataset.dateclear); if (p) p.peremption = null; dateOpen = null; render();
      await majInv(dcl.dataset.dateclear, { peremption: null }); return; }
    const ap = e.target.closest("[data-approuver]");
    if (ap) { ap.disabled = true; const r = lirePanierRow(ap.dataset.approuver);
      if (await approuver(r)) { status(`« ${r.nom} » rangé${r.espace_id ? " dans " + ((state.espaces.find((x) => x.id === r.espace_id) || {}).nom || "son espace") : ""}.`); render(); scheduleReload("produits"); scheduleReload("epicerie"); }
      else ap.disabled = false;
      return; }
    const ign = e.target.closest("[data-ignorer]");
    if (ign) { const id = ign.dataset.ignorer; state.panier = state.panier.filter((x) => x.id !== id); render(); await run(sb.from("panier").delete().eq("id", id)); return; }
    if (e.target.closest("#panier-tout")) {
      const ids = state.panier.map((r) => r.id); let n = 0;
      status("Rangement en cours…");
      for (const id of ids) { if (await approuver(lirePanierRow(id))) n++; }
      status(`${n} article${n > 1 ? "s" : ""} rangé${n > 1 ? "s" : ""}.`); render(); scheduleReload("produits"); scheduleReload("epicerie"); return;
    }
    if (e.target.closest("#panier-vider")) {
      const ids = state.panier.map((r) => r.id); state.panier = []; render();
      if (ids.length) await run(sb.from("panier").delete().in("id", ids)); return;
    }
    const mo = e.target.closest("[data-move]");
    if (mo) { moveOpen = moveOpen === mo.dataset.move ? null : mo.dataset.move; delOpen = null; renderMaison(); return; }
    const ef = e.target.closest("[data-effacer]");
    if (ef) { delOpen = delOpen === ef.dataset.effacer ? null : ef.dataset.effacer; moveOpen = null; renderMaison(); return; }
    if (e.target.closest("[data-effacer-annuler]")) { delOpen = null; renderMaison(); return; }
    const rm = e.target.closest("[data-retirer-maison]");
    if (rm) {
      const p = state.prod.find((x) => x.id === rm.dataset.retirerMaison); delOpen = null; if (!p) return;
      p.stock = 0; p.peremption = null; render();
      if (await majInv(p.id, { stock: 0, peremption: null })) status(`« ${p.nom} » est épuisé; il reste dans l'onglet Produits.`);
      return;
    }
    const eo = e.target.closest("[data-effacer-ok]");
    if (eo) {
      const p = state.prod.find((x) => x.id === eo.dataset.effacerOk); delOpen = null; if (!p) return;
      state.prod = state.prod.filter((x) => x.id !== p.id); render();
      if (await run(sb.from("produits").delete().eq("id", p.id), `« ${p.nom} » supprimé.`)) {
        scheduleReload("produits");
      }
      return;
    }
    const mt = e.target.closest("[data-moveto]");
    if (mt) {
      const p = state.prod.find((x) => x.id === mt.dataset.id); if (!p) return;
      const dest = mt.dataset.moveto || null;
      const nomDest = dest ? (state.espaces.find((x) => x.id === dest) || {}).nom : "Sans espace";
      p.espace_id = dest; moveOpen = null; render();
      if (await majInv(p.id, { espace_id: dest })) status(`« ${p.nom} » déplacé vers ${nomDest}.`);
      return;
    }
    const sbt = e.target.closest("[data-stock]");
    if (sbt) { await ajusterStock(sbt.dataset.id, Number(sbt.dataset.stock)); return; }
    const mv = e.target.closest("[data-espmove]");
    if (mv) {
      const esp = espacesTries(); const i = esp.findIndex((x) => x.id === mv.dataset.id); const j = i + Number(mv.dataset.espmove);
      if (i < 0 || j < 0 || j >= esp.length) return;
      [esp[i], esp[j]] = [esp[j], esp[i]];
      esp.forEach((x, k) => (x.ordre = k + 1)); render();
      for (const [k, x] of esp.entries()) await run(sb.from("espaces").update({ ordre: k + 1 }).eq("id", x.id));
      return;
    }
    if (e.target.closest("#add-bas")) {
      const rows = state.prod.filter((p) => estBas(p) && !dansListe(p.nom, listeDe(p))).map((p) => ({ nom: p.nom, liste_id: listeDe(p), ...(p.photo ? { photo: p.photo } : {}) }));
      if (rows.length && await run(sb.from("epicerie").insert(rows), `${rows.length} article${rows.length > 1 ? "s" : ""} ajouté${rows.length > 1 ? "s" : ""} à la liste.`)) scheduleReload("epicerie");
      return;
    }
    const pp = e.target.closest("[data-prodphoto]");
    if (pp) { prodPhotoTarget = pp.dataset.prodphoto; $("#in-prod-photo").click(); return; }
    if (e.target.closest("[data-stop] input, [data-stop] select")) return;
    const d = e.target.closest("[data-del]");
    if (d) {
      const t = d.dataset.del, key = TABLES[t];
      local(t, () => (state[key] = state[key].filter((x) => x.id !== d.dataset.id)));
      if (t === "produits") openProd = null;
      await run(sb.from(t).delete().eq("id", d.dataset.id)); return;
    }
    const st = e.target.closest("[data-store]");
    if (st) {
      const cur = [...stores()]; cur.splice(+st.dataset.store, 1);
      await majMagasins(cur); return;
    }
    const a = e.target.closest("[data-addfrom]");
    if (a) { const s = state.spec.find((x) => x.id === a.dataset.addfrom); if (s) { const p = state.prod.find((x) => norm(x.nom) === norm(s.item)); const l = listeDe(p); if (await run(sb.from("epicerie").insert({ nom: s.item, liste_id: l }), `« ${s.item} » ajouté à « ${nomListe(l)} ».`)) scheduleReload("epicerie"); } return; }
    const ig = e.target.closest("[data-ignore]");
    if (ig) { local("speciaux", () => (state.spec = state.spec.filter((x) => x.id !== ig.dataset.ignore))); await run(sb.from("speciaux").update({ ignore: true }).eq("id", ig.dataset.ignore)); return; }
    const tl = e.target.closest("[data-tolist]");
    if (tl) {
      e.stopPropagation();
      const p = state.prod.find((x) => x.id === tl.dataset.tolist); if (!p) return;
      const deja = dansListeLieu(p);
      // Sur la ligne d'un produit, le bouton 🛒 / ✓ ajoute ou retire ; dans la fiche, il ajoute seulement
      if (deja && tl.classList.contains("cart")) {
        local("epicerie", () => (state.liste = state.liste.filter((i) => i.id !== deja.id)));
        // Juste ajouté, l'article n'a peut-être pas encore son vrai numéro : on retire par liste et par nom
        const req = String(deja.id).startsWith("tmp-") ? sb.from("epicerie").delete().eq("liste_id", deja.liste_id).eq("nom", deja.nom).eq("fait", false) : sb.from("epicerie").delete().eq("id", deja.id);
        if (await run(req, `« ${p.nom} » retiré de « ${nomListe(deja.liste_id)} ».`)) scheduleReload("epicerie"); return;
      }
      if (deja) { status(`« ${p.nom} » est déjà dans « ${nomListe(deja.liste_id)} ».`); return; }
      const l = listeDe(p);
      const tmp = { id: "tmp-" + Date.now(), nom: p.nom, liste_id: l, fait: false, qte: null };
      local("epicerie", () => state.liste.push(tmp));
      if (await run(sb.from("epicerie").insert({ nom: p.nom, liste_id: l }), `🛒 « ${p.nom} » ajouté à « ${nomListe(l)} ».`)) scheduleReload("epicerie");
      else local("epicerie", () => (state.liste = state.liste.filter((i) => i !== tmp)));
      return;
    }
    const tw = e.target.closest("[data-survtoggle]");
    if (tw) {
      e.stopPropagation();
      const p = state.prod.find((x) => x.id === tw.dataset.survtoggle); if (!p) return;
      p.surveiller = !p.surveiller; render();
      await run(sb.from("produits").update({ surveiller: p.surveiller }).eq("id", p.id), p.surveiller ? `★ « ${p.nom} » : l'agent surveillera ses spéciaux chaque jeudi.` : `« ${p.nom} » n'est plus surveillé.`);
      return;
    }
    const fc = e.target.closest("[data-filter]");
    if (fc) { filtre = fc.dataset.filter; renderProducts(); return;
    }
    if (e.target.closest("[data-stop]")) return;
    const row = e.target.closest("[data-prod]");
    if (row) { openProd = openProd === row.dataset.prod ? null : row.dataset.prod; renderProducts(); }
  });
  $("#v-maison").addEventListener("click", async (e) => {
    const c = e.target.closest("[data-lieu]"); if (c) return choisirLieu(c.dataset.lieu);
    if (e.target.closest("[data-lieu-new]")) { lieuEnEdition = !lieuEnEdition; renderLieux(); if (lieuEnEdition) setTimeout(() => $("#in-nouveau-lieu").focus(), 30); return; }
    const mv = e.target.closest("[data-lieumove]");
    if (mv) {
      const ls = lieuxTries(), i = ls.findIndex((x) => x.id === mv.dataset.id), j = i + Number(mv.dataset.lieumove);
      if (i < 0 || j < 0 || j >= ls.length) return;
      [ls[i], ls[j]] = [ls[j], ls[i]]; ls.forEach((x, k) => (x.ordre = k + 1)); render();
      for (const [k, x] of ls.entries()) await run(sb.from("lieux").update({ ordre: k + 1 }).eq("id", x.id));
      return;
    }
    const d = e.target.closest("[data-lieudel]"); if (d) { lieuASupprimer = d.dataset.lieudel; renderLieux(); return; }
    if (e.target.closest("[data-lieudel-annuler]")) { lieuASupprimer = null; renderLieux(); return; }
    const ok = e.target.closest("[data-lieudel-ok]");
    if (ok) {
      const id = ok.dataset.lieudelOk, nom = nomLieu(id); lieuASupprimer = null;
      state.lieux = state.lieux.filter((x) => x.id !== id); state.inv = state.inv.filter((x) => x.lieu_id !== id); state.espaces = state.espaces.filter((x) => x.lieu_id !== id);
      if (lieuActif === id) lieuActif = null; appliquerLieu(); render();
      await run(sb.from("lieux").delete().eq("id", id), `Lieu « ${nom} » supprimé.`); return;
    }
  });
  $("#v-maison").addEventListener("change", async (e) => {
    const n = e.target.closest("[data-lieunom]"); if (!n) return;
    const v = n.value.trim(); if (!v) return;
    const l = state.lieux.find((x) => x.id === n.dataset.lieunom); if (l) l.nom = v;
    await run(sb.from("lieux").update({ nom: v }).eq("id", n.dataset.lieunom), "Lieu renommé."); render();
  });
  $("#f-nouveau-lieu").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-nouveau-lieu").value.trim(); if (!nom) return;
    if (state.lieux.some((x) => norm(x.nom) === norm(nom))) { status(`Le lieu « ${nom} » existe déjà.`); return; }
    const ordre = Math.max(0, ...state.lieux.map((x) => x.ordre || 0)) + 1;
    const { data, error } = await sb.from("lieux").insert({ nom, ordre, magasins: [] }).select("*").single();
    if (error) { status("Le lieu n'a pas pu être créé. Réessayez."); return; }
    state.lieux.push(data);
    const base = ["Garde-manger", "Réfrigérateur", "Congélateur"].map((n, i) => ({ nom: n, ordre: i + 1, lieu_id: data.id }));
    const { data: esp } = await sb.from("espaces").insert(base).select("*");
    if (esp) state.espaces.push(...esp);
    const { data: li } = await sb.from("listes").insert({ nom: "Épicerie", ordre: 1, lieu_id: data.id }).select("*").single();
    if (li) state.listes.push(li);
    $("#in-nouveau-lieu").value = ""; lieuEnEdition = false; choisirLieu(data.id);
    status(`Lieu « ${nom} » créé avec ses espaces et sa liste « Épicerie ». Ajoutez ses produits dans l'onglet Produits, et ses épiceries dans l'onglet Spéciaux.`);
  });

  // Corriger un article de la liste : toucher son nom
  function ouvrirEditListe(id) {
    const i = state.liste.find((x) => x.id === id); if (!i) return;
    editListe = id; brouillonListe = { nom: i.nom || "", qte: i.qte || "", liste_id: i.liste_id || idListeActive() };
    render(); setTimeout(() => { const n = $("#el-nom"); if (n) { n.focus(); n.select(); } }, 30);
  }
  function fermerEditListe() { editListe = null; brouillonListe = null; render(); }
  // Spéciaux : ouvrir un produit surveillé, ou aller choisir quoi surveiller
  $("#v-speciaux").addEventListener("click", (e) => {
    const o = e.target.closest("[data-survopen]");
    if (o) { openProd = o.dataset.survopen; filtre = "surv"; showView("produits"); render(); setTimeout(() => { const el = document.querySelector(`[data-prod="${o.dataset.survopen}"]`) || $("#v-produits"); el.scrollIntoView({ block: "center" }); }, 60); return; }
    if (e.target.closest("[data-survajout]")) { filtre = "tous"; showView("produits"); render(); status("Touchez l'étoile ☆ à droite d'un produit pour que Rosalie surveille ses rabais."); }
  });
  $("#v-liste").addEventListener("input", (e) => { const f = e.target.dataset && e.target.dataset.el; if (f && brouillonListe) brouillonListe[f] = e.target.value; });
  $("#v-liste").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editListe) { fermerEditListe(); return; }
    const m = e.target.closest && e.target.closest("[data-editliste]");
    if (m && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ouvrirEditListe(m.dataset.editliste); }
  });
  $("#v-liste").addEventListener("submit", async (e) => {
    const f = e.target.closest(".f-edit-liste"); if (!f) return;
    e.preventDefault();
    const d = brouillonListe || {}, nom = (d.nom || "").trim();
    if (!nom) { status("Donnez un nom à l'article."); return; }
    const maj = { nom, qte: (d.qte || "").trim() || null };
    if (d.liste_id) maj.liste_id = d.liste_id;
    const id = f.dataset.id, ancien = state.liste.find((x) => x.id === id);
    if (ancien) Object.assign(ancien, maj);
    editListe = null; brouillonListe = null; render();
    const ailleurs = maj.liste_id && maj.liste_id !== idListeActive();
    await run(sb.from("epicerie").update(maj).eq("id", id), ailleurs ? `« ${nom} » déplacé dans « ${nomListe(maj.liste_id)} ».` : `« ${nom} » corrigé.`);
    scheduleReload("epicerie");
  });
  $("#v-liste").addEventListener("click", async (e) => {
    if (e.target.closest("[data-el-annuler]")) { fermerEditListe(); return; }
    const ed = e.target.closest("[data-editliste]"); if (ed) { ouvrirEditListe(ed.dataset.editliste); return; }
    const c = e.target.closest("[data-liste]"); if (c) return choisirListe(c.dataset.liste);
    if (e.target.closest("[data-liste-new]")) { listeEnEdition = !listeEnEdition; renderListes(); if (listeEnEdition) setTimeout(() => $("#in-nouvelle-liste").focus(), 30); return; }
    const mv = e.target.closest("[data-listemove]");
    if (mv) {
      const ls = listesTriees(), i = ls.findIndex((x) => x.id === mv.dataset.id), j = i + Number(mv.dataset.listemove);
      if (i < 0 || j < 0 || j >= ls.length) return;
      [ls[i], ls[j]] = [ls[j], ls[i]]; ls.forEach((x, k) => (x.ordre = k + 1)); render();
      for (const [k, x] of ls.entries()) await run(sb.from("listes").update({ ordre: k + 1 }).eq("id", x.id));
      return;
    }
    const d = e.target.closest("[data-listedel]"); if (d) { listeASupprimer = d.dataset.listedel; renderListes(); return; }
    if (e.target.closest("[data-listedel-annuler]")) { listeASupprimer = null; renderListes(); return; }
    const ok = e.target.closest("[data-listedel-ok]");
    if (ok) {
      const id = ok.dataset.listedelOk, nom = nomListe(id); listeASupprimer = null;
      state.listes = state.listes.filter((x) => x.id !== id); state.liste = state.liste.filter((x) => x.liste_id !== id);
      if (listeActive === id) listeActive = null; render();
      await run(sb.from("listes").delete().eq("id", id), `Liste « ${nom} » supprimée.`); scheduleReload("epicerie"); return;
    }
  });
  $("#v-liste").addEventListener("change", async (e) => {
    if (e.target.dataset && e.target.dataset.el && brouillonListe) { brouillonListe[e.target.dataset.el] = e.target.value; return; }
    const n = e.target.closest("[data-listenom]"); if (!n) return;
    const v = n.value.trim(); if (!v) return;
    await run(sb.from("listes").update({ nom: v }).eq("id", n.dataset.listenom), "Liste renommée."); scheduleReload("listes");
  });
  $("#f-nouvelle-liste").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-nouvelle-liste").value.trim(); if (!nom) return;
    if (listesTriees().some((x) => norm(x.nom) === norm(nom))) { status(`La liste « ${nom} » existe déjà ici.`); return; }
    const ordre = Math.max(0, ...state.listes.map((x) => x.ordre || 0)) + 1;
    const { data, error } = await sb.from("listes").insert({ nom, ordre, lieu_id: idLieu() }).select("*").single();
    if (error) { status("La liste n'a pas pu être créée. Réessayez."); return; }
    state.listes.push(data); $("#in-nouvelle-liste").value = ""; listeEnEdition = false; choisirListe(data.id);
    status(`Liste « ${nom} » créée. Ajoutez-y vos articles.`);
  });

  $("#clear-done").addEventListener("click", async () => {
    const lid = idListeActive();
    const ids = state.liste.filter((i) => i.fait && (i.liste_id === lid || !i.liste_id)).map((i) => i.id);
    if (!ids.length) return;
    local("epicerie", () => (state.liste = state.liste.filter((i) => !ids.includes(i.id))));
    await run(sb.from("epicerie").delete().in("id", ids));
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.email) loadAll(); });

  // ---------- connexion : le compte HoldingAI (compte.holdingai.app), le même pour toutes les apps HoldingAI.
  // Albert, le majordome de HoldingAI, accueille sur compte.holdingai.app puis annonce Rosalie.
  const loginStatus = (m) => { $("#login-status").textContent = m || ""; };
  const loginForms = ["#f-login", "#f-foyer"];
  function loginView(id) { loginForms.forEach((f) => ($(f).hidden = f !== id)); loginStatus(""); }
  // Mémoire de la visite (onglet seulement) : prénom saisi à l'inscription, achat demandé depuis le site
  const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const ssSet = (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} };
  // Liens du site : ?acheter mène au paiement après la connexion
  const entree = new URLSearchParams(location.search);
  if (entree.has("acheter")) ssSet("apres", "acheter");
  // Lien de parrainage (?ref=CODE) : gardé sur l'appareil jusqu'à la création du foyer
  const refCle = "commis.ref";
  const refGet = () => { try { return localStorage.getItem(refCle); } catch (e) { return null; } };
  const refSet = (v) => { try { v ? localStorage.setItem(refCle, v) : localStorage.removeItem(refCle); } catch (e) {} };
  if (/^[A-Za-z0-9]{6}$/.test(entree.get("ref") || "")) refSet(entree.get("ref").toUpperCase());
  async function montrerCadeau() {
    const code = refGet(); if (!code) return;
    let qui = null;
    try { const { data } = await sb.rpc("parrain_prenom", { p_code: code }); qui = data; } catch (e) {}
    $("#login-cadeau").innerHTML = `🎁 <b>${esc(qui || "Un proche")} vous offre 60 jours gratuits</b> au lieu de 30. Connectez-vous, puis créez votre foyer.`;
    $("#login-cadeau").hidden = false;
  }
  montrerCadeau();
  if (entree.has("essai") || entree.has("acheter") || entree.has("ref") || entree.has("installer")) history.replaceState(null, "", location.pathname + location.hash);
  $("#hai").addEventListener("click", async (e) => {
    e.target.disabled = true; loginStatus("");
    try { await HoldingAI.connecter(); } catch (err) { loginStatus("La connexion HoldingAI n'a pas pu démarrer. Réessayez."); e.target.disabled = false; }
  });
  $("#logout").addEventListener("click", () => deconnecter());

  // ---------- créer son foyer (essai de 30 jours)
  $("#f-foyer").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nom = $("#in-foyer-nom").value.trim(), prenom = $("#in-foyer-prenom").value.trim();
    if (!prenom) { loginStatus("Entrez votre prénom."); return; }
    loginStatus("Création de votre foyer…");
    const cc = ($("#in-code-cadeau").value || "").trim().toUpperCase();
    if (cc) { if (!/^[A-Z0-9]{6}$/.test(cc)) { loginStatus("Le code cadeau a 6 lettres ou chiffres."); return; } refSet(cc); }
    const ref = refGet();
    const { error } = await sb.rpc("creer_foyer", { p_nom: nom || "Mon foyer", p_prenom: prenom, p_ref: ref });
    if (error) { console.error(error); loginStatus(String(error.message || "").includes("deja_membre") ? "Vous faites déjà partie d'un foyer. Reconnectez-vous." : "Le foyer n'a pas pu être créé. Réessayez dans un moment."); return; }
    loginStatus("");
    current = null; await onSession(await sessionHAI());
    refSet(null);
    status(`Votre foyer est créé. L'essai gratuit dure ${ref ? "60" : "30"} jours : tout est ouvert.`);
  });
  $("#foyer-annuler").addEventListener("click", () => deconnecter());

  // ---------- forfait : essai, payé, terminé
  const PRIX = "19,99 $ par année";
  const estProprio = () => !!(state.foyer && state.userId && state.foyer.proprio === state.userId);
  function etatForfait() {
    const f = state.foyer; if (!f) return { actif: true, type: "inconnu" };
    const now = Date.now(), essai = new Date(f.essai_fin).getTime(), paye = f.paye_jusqua ? new Date(f.paye_jusqua).getTime() : 0;
    if (paye > now) return { actif: true, type: "paye", jusqua: f.paye_jusqua, fondateur: new Date(f.paye_jusqua).getFullYear() >= 2090 };
    if (essai > now) return { actif: true, type: "essai", jours: Math.max(1, Math.ceil((essai - now) / 864e5)) };
    return { actif: false, type: "termine" };
  }
  const lienAchat = () => `${(window.EPICERIE_CONFIG && window.EPICERIE_CONFIG.siteUrl) || "https://lecommis.ai/"}achat.html?foyer=${encodeURIComponent(state.foyer ? state.foyer.id : "")}&nom=${encodeURIComponent(state.foyer ? state.foyer.nom : "")}`;
  function renderForfait() {
    const box = $("#forfait"), et = etatForfait(), proprio = estProprio();
    const nomProprio = (state.membres.find((m) => m.role === "proprio") || {}).nom || "le propriétaire";
    document.body.classList.toggle("lecture-seule", !et.actif);
    if (et.type === "paye" && et.fondateur) { box.innerHTML = ""; return; }
    if (et.type === "paye") { box.innerHTML = `<p class="hint forfait-ok">Forfait actif jusqu'au ${fmtDate(String(et.jusqua).slice(0, 10))}.${proprio ? ` <a class="link" href="${lienAchat()}" target="_blank" rel="noopener">Renouveler</a>` : ""}</p>`; return; }
    if (et.type === "essai") {
      box.innerHTML = `<div class="forfait essai"><span><b>Essai gratuit</b> : ${et.jours} jour${et.jours > 1 ? "s" : ""} restant${et.jours > 1 ? "s" : ""}.</span>
        ${proprio ? `<a class="btn small" href="${lienAchat()}" target="_blank" rel="noopener">Acheter · ${PRIX}</a>` : `<span class="hint">${esc(prenom(nomProprio))} pourra acheter l'app.</span>`}</div>`;
      return;
    }
    box.innerHTML = `<div class="forfait fini"><div><b>L'essai gratuit est terminé.</b><br>Vos données sont gardées : vous pouvez les consulter, mais plus les modifier.</div>
      ${proprio ? `<a class="btn" href="${lienAchat()}" target="_blank" rel="noopener">Acheter l'app · ${PRIX}</a><p class="hint">L'app se réactive toute seule après le paiement.</p>`
        : `<p class="hint">Demandez à ${esc(prenom(nomProprio))}, propriétaire du foyer, d'acheter l'app.</p>`}</div>`;
  }

  // ---------- Mon compte : le rond avec les initiales, en haut à droite (comme dans Fanion)
  function initiales(nom) { return String(nom || "").split(/[\s-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("") || "👤"; }
  function majCompte() {
    const me = moiMembre() || {}, ini = initiales(me.nom);
    $("#compte-ini").textContent = ini; $("#compte-rond").textContent = ini;
    $("#open-compte").title = "Mon compte" + (me.nom ? " · " + me.nom : "");
    const tel = state.userPhone ? fmtTel(state.userPhone) : state.userEmail || "";
    $("#compte-info").textContent = [tel, state.foyer && state.foyer.nom, estProprio() ? "propriétaire" : ""].filter(Boolean).join(" · ");
    const n = state.membres.length; $("#compte-nmembres").textContent = n ? `${n} sur 4` : "";
    const et = etatForfait(), proprio = estProprio();
    $("#compte-forfait").innerHTML = et.type === "paye" ? `<p class="compte-forfait ok">Forfait actif${et.fondateur ? " · membre fondateur" : ` jusqu'au ${fmtDate(String(et.jusqua).slice(0, 10))}`}.${proprio && !et.fondateur ? ` <a class="link" href="${lienAchat()}" target="_blank" rel="noopener">Renouveler</a>` : ""}</p>`
      : et.type === "essai" ? `<p class="compte-forfait">Essai gratuit : <b>${et.jours} jour${et.jours > 1 ? "s" : ""}</b> restant${et.jours > 1 ? "s" : ""}.${proprio ? ` <a class="btn small" href="${lienAchat()}" target="_blank" rel="noopener">Acheter · ${PRIX}</a>` : ""}</p>`
      : et.type === "termine" ? `<p class="compte-forfait fini">L'essai est terminé.${proprio ? ` <a class="btn small" href="${lienAchat()}" target="_blank" rel="noopener">Acheter · ${PRIX}</a>` : ""}</p>` : "";
  }
  $("#open-compte").addEventListener("click", () => {
    const ouvrir = $("#compte").hidden; fermerPanneaux(ouvrir ? "#compte" : null);
    $("#compte").hidden = !ouvrir;
    if (ouvrir) { majCompte(); $("#compte").scrollIntoView({ block: "start", behavior: "smooth" }); }
  });
  $("#close-compte").addEventListener("click", () => { $("#compte").hidden = true; });
  // ---------- Rosalie toujours présente : son visage dans le coin ouvre l'aide; elle salue à chaque arrivée
  let rosalie = null;
  function messageArrivee() {
    const h = new Date().getHours(), salut = h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
    const nom = prenom((moiMembre() || {}).nom);
    const exp = bientot().length, spec = state.spec.filter((s) => !s.ignore).length;
    const aAcheter = state.liste.filter((i) => !i.fait).length, panier = state.panier.length;
    let texte, bouton = null, action = null;
    if (panier) { texte = `${panier} article${panier > 1 ? "s" : ""} de votre facture attend${panier > 1 ? "ent" : ""} d'être approuvé${panier > 1 ? "s" : ""}.`; bouton = "Voir le panier"; action = () => showView("produits"); }
    else if (exp) { texte = `${exp} produit${exp > 1 ? "s" : ""} va${exp > 1 ? "nt" : ""} passer date d'ici 3 jours. On les mange en premier?`; bouton = "Voir lesquels"; action = () => showView("maison"); }
    else if (spec) { texte = `${spec} spécia${spec > 1 ? "ux" : "l"} sur vos produits cette semaine.`; bouton = "Voir les spéciaux"; action = () => showView("speciaux"); }
    else if (aAcheter) { texte = `${aAcheter} article${aAcheter > 1 ? "s" : ""} sur la liste d'épicerie.`; bouton = "Voir la liste"; action = () => showView("liste"); }
    else texte = "Tout est en ordre. Touchez mon visage si vous avez une question.";
    return { titre: `${salut}${nom ? ", " + nom : ""}!`, texte, bouton, action, duree: 9000 };
  }
  function accueilRosalie() {
    if (!window.CommisGuide) return;
    if (!rosalie) rosalie = CommisGuide.presence({ surFace: () => ouvrirCommis(), label: "Parler à Rosalie, votre commis" });
    rosalie.cacher(false);
    // Une fois par ouverture de l'app, après la visite des nouveaux
    if (ssGet("rosalie.salut") || !$("#bienvenue").hidden || document.querySelector(".cg-fond")) return;
    ssSet("rosalie.salut", "1");
    setTimeout(() => { if (!document.querySelector(".cg-fond")) rosalie.dire(messageArrivee()); }, 1200);
  }

  async function onSession(session) {
    if (!session) {
      state.email = null; state.userEmail = null; state.userPhone = null; state.userId = null; state.foyer = null;
      $("#bienvenue").hidden = true; $("#demarrer").innerHTML = "";
      if (rosalie) rosalie.cacher(true);
      if (channel) { sb.removeChannel(channel); channel = null; }
      $("#app").hidden = true; $("#login").hidden = false;
      loginView("#f-login"); $("#hai").disabled = false;
      return;
    }
    state.userEmail = session.user.email || null;
    state.userPhone = session.user.phone || null;
    state.email = state.userEmail || state.userPhone;
    const { data: membres } = await sb.from("membres").select("id, email, telephone, nom, invite_par, role, cree");
    if (!membres || !membres.length) {
      // Nouveau compte avec un prénom saisi à l'inscription : on crée son foyer tout de suite (essai de 30 jours)
      const p = ssGet("prenom");
      if (p) {
        ssSet("prenom", null);
        const ref = refGet();
        const { error } = await sb.rpc("creer_foyer", { p_nom: "Foyer de " + p, p_prenom: p, p_ref: ref });
        if (!error) { refSet(null); status(`Bienvenue! Votre essai gratuit de ${ref ? "60" : "30"} jours commence : tout est ouvert.`); return onSession(session); }
        console.error(error);
      }
      // Sinon : on propose de créer un foyer
      $("#login").hidden = false; $("#app").hidden = true; loginView("#f-foyer");
      if (!$("#in-foyer-prenom").value && session.user.nom) $("#in-foyer-prenom").value = session.user.nom;
      if (refGet()) { $("#in-code-cadeau").value = refGet(); $("#code-cadeau").open = true; }
      $("#foyer-intro").textContent = `${state.userPhone ? "Le " + fmtTel(state.userPhone) : "L'adresse " + state.userEmail} n'appartient à aucun foyer. Créez le vôtre : l'essai est gratuit pendant 30 jours. Si quelqu'un vous a invité, demandez-lui de vérifier le cellulaire inscrit dans « Membres ».`;
      return;
    }
    const { data: foyer } = await sb.from("foyers").select("*").maybeSingle();
    state.foyer = foyer || null;
    state.membres = membres;
    const me = membres.find(estMoi);
    $("#who").textContent = (me && me.nom) || (state.userPhone ? fmtTel(state.userPhone) : state.userEmail);
    majCompte();
    $("#login").hidden = true; $("#app").hidden = false;
    state.userId = session.user.id;
    state.userCreated = (me && me.cree) || session.user.created_at || null;
    renderForfait();
    await loadAll();
    await etatRappel().catch(() => {});
    if (ssGet("apres") === "acheter") {
      ssSet("apres", null);
      if (estProprio()) { location.href = lienAchat(); return; }
      status(`Seul le propriétaire du foyer peut acheter l'app. Demandez à ${prenom(((state.membres || []).find((m) => m.role === "proprio") || {}).nom || "lui")}.`);
    }
    maybeBienvenue(); renderDemarrer(); renderAvis(); renderOffrirCarte(); chargerRetour();
    accueilRosalie();
    if (location.hash === "#bilan") ouvrirBilan();
    subscribe();
  }
  let current = null;
  // Démarrage : au retour de compte.holdingai.app, échanger le code contre les jetons, puis ouvrir la session.
  (async () => {
    // Démarrage commun à toutes les apps HoldingAI (holdingai.js) : retour de chez Albert, puis le compte suit.
    const installee = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const dep = await HoldingAI.demarrer({ obligatoire: installee || !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) });
    if (dep.redirection) return;
    const erreur = dep.erreur ? (dep.erreur.message || "La connexion HoldingAI n'a pas fonctionné.") : "";
    const session = await sessionHAI();
    window.HOLDINGAI_PORTE = { app: "le-commis", nomApp: "Le Commis", prenom: session ? session.user.nom : "",
      liens: [{ texte: "Mon foyer, membres et forfait", action: () => { const b = $("#open-compte"); if (b && $("#compte").hidden) b.click(); } }],
      surDeconnexion: () => deconnecter() };
    // Première connexion HoldingAI : reprendre ce qui était lié à l'ancien compte du Commis (propriétaire, idées…)
    if (session) { try { await sb.rpc("reprendre_compte"); } catch (e) { /* rien */ } }
    current = session ? session.user.id : null;
    if (!session && (installee || !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent))) { window.HOLDINGAI_PORTE.personnage = "Rosalie"; window.HOLDINGAI_PORTE = Object.assign(window.HOLDINGAI_PORTE || {}, { barriere: true }); if (window.HoldingAIPorte) HoldingAIPorte.barriere(); }
    await onSession(session);
    if (erreur) loginStatus(erreur);
  })();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  /* Mise à jour automatique : l'app installée sur l'écran d'accueil reste ouverte en arrière-plan pendant des jours.
     À chaque retour dans l'app (et aux 30 minutes), on regarde si une nouvelle version est en ligne ; si oui, on recharge.
     On attend si la personne est en train d'écrire ou si une fenêtre est ouverte. */
  (function () {
    if (location.protocol === 'file:' || !window.fetch) return;
    var ENTETES = ['index.html', 'app.js', 'style.css', 'config.js'], TEXTES = ['sw.js'], OUVERT = '[role="dialog"]:not([hidden]), dialog[open]';
    var base = null, dernier = 0, attente = null;
    function lire() {
      var e = ENTETES.map(function (f) { return fetch(f, { method: 'HEAD', cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return (r.headers.get('etag') || r.headers.get('last-modified') || '').replace(/^W\//, ''); }); });
      var t = TEXTES.map(function (f) { return fetch(f, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.text(); }); });
      return Promise.all(e.concat(t)).then(function (a) { return a.join('|'); });
    }
    function occupe() {
      var a = document.activeElement;
      if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true;
      return !!document.querySelector(OUVERT);
    }
    function recharger(sig) {
      if (occupe()) { clearTimeout(attente); attente = setTimeout(function () { recharger(sig); }, 20000); return; }
      try {
        var d = JSON.parse(sessionStorage.getItem('maj.auto') || '{}');
        // Jamais deux fois pour la même version, ni plus d'une fois aux 5 minutes : pas de boucle possible
        if (d.sig === sig || Date.now() - (d.t || 0) < 300000) return;
        sessionStorage.setItem('maj.auto', JSON.stringify({ sig: sig, t: Date.now() }));
      } catch (x) { return; }
      location.reload();
    }
    function verifier() {
      if (document.visibilityState !== 'visible' || navigator.onLine === false || Date.now() - dernier < 60000) return;
      dernier = Date.now();
      lire().then(function (sig) {
        if (!sig.replace(/\|/g, '')) return;
        if (base === null) { base = sig; return; }
        if (sig !== base) recharger(sig);
      }).catch(function () { dernier = 0; });
    }
    window.addEventListener('load', verifier);
    document.addEventListener('visibilitychange', verifier);
    window.addEventListener('pageshow', function (e) { if (e.persisted) verifier(); });
    window.addEventListener('online', verifier);
    setInterval(verifier, 1800000);
  })();
})();
