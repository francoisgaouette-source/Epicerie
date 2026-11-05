(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const cfg = window.EPICERIE_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  const DEFAULT_STORES = ["IGA", "Metro", "Maxi", "Super C", "Provigo"];
  const CATS = ["Fruits et légumes", "Viandes et poissons", "Produits laitiers et œufs", "Boulangerie", "Épicerie sèche",
    "Surgelés", "Boissons", "Collations", "Hygiène et beauté", "Entretien ménager", "Autre"];
  const state = { liste: [], spec: [], prod: [], espaces: [], panier: [], config: null, membres: [], email: null };
  let openProd = null, search = "", channel = null, filtre = "tous";
  const surveilles = () => state.prod.filter((p) => p.surveiller);

  // ---------- utils
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const num = (v) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const money = (n) => (typeof n === "number" && isFinite(n)) ? n.toFixed(2).replace(".", ",") + " $" : "";
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const status = (m) => { $("#status").textContent = m || ""; };
  const stores = () => (state.config && Array.isArray(state.config.magasins) && state.config.magasins.length) ? state.config.magasins : DEFAULT_STORES;
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
    const path = `${dossier ? dossier + "/" : ""}${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
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
  $("#in-pcat").innerHTML = CATS.map((c) => `<option>${c}</option>`).join("");
  $("#in-pcat").value = "Autre";

  // ---------- render
  function render() {
    const pm = prodMap();

    // LISTE
    const liste = [...state.liste].sort((a, b) => (a.fait - b.fait) || (a.cree < b.cree ? -1 : 1));
    const restants = liste.filter((i) => !i.fait);
    $("#c-liste").textContent = restants.length;
    if (!liste.length) {
      $("#list-liste").innerHTML = emptyBox("La liste est vide", "Ajoute un article ci-dessus. L'autre personne le verra aussitôt.");
      $("#liste-actions").hidden = true;
    } else {
      const saleNames = new Set(state.spec.filter((s) => !s.ignore).map((s) => norm(s.item)));
      $("#list-liste").innerHTML = `<ul class="list">${liste.map((i) => {
        const by = nameOf(i.par); const p = pm.get(norm(i.nom)); const b = p && bestOf(p);
        const onSale = saleNames.has(norm(i.nom)) || (b && b.special);
        const ph = photoOf(i, pm);
        return `<li class="${i.fait ? "done" : ""}">
          <input type="checkbox" class="check" id="chk-${i.id}" data-id="${i.id}" ${i.fait ? "checked" : ""} aria-label="Acheté : ${esc(i.nom)}">
          ${thumb(ph, i.nom)}
          <div class="main"><div class="name">${esc(i.nom)}${i.qte ? ` <span class="meta">× ${esc(i.qte)}</span>` : ""}${onSale ? '<span class="sale">en spécial</span>' : ""}</div>
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
    const spec = state.spec.filter((s) => !s.ignore)
      .sort((a, b) => norm(a.item).localeCompare(norm(b.item)) || (num(a.prix) || 0) - (num(b.prix) || 0));
    $("#c-speciaux").textContent = spec.length;
    $("#c-speciaux").classList.toggle("hot", spec.length > 0);
    const c = state.config;
    $("#agent-info").innerHTML = c && c.derniere_verif
      ? `Dernière vérification : <b>${fmtDate(c.derniere_verif)}</b>${c.semaine ? ` · circulaires ${esc(c.semaine)}` : ""}${c.resume ? `<br>${esc(c.resume)}` : ""}`
      : `L'agent vérifie les circulaires <b>chaque jeudi matin</b>. Les spéciaux des produits surveillés (★ dans le Catalogue) apparaîtront ici.`;
    $("#list-spec").innerHTML = spec.length ? `<div class="deals">${spec.map((s) => {
      const inList = state.liste.some((i) => !i.fait && norm(i.nom) === norm(s.item));
      const pr = num(s.prix), rg = num(s.prix_reg);
      return `<div class="deal">
        <div><div class="store">${esc(s.magasin)}${s.fin ? ` · jusqu'au ${fmtDate(s.fin)}` : ""}</div><div class="name">${esc(s.item)}</div></div>
        <div><div class="price">${pr != null ? money(pr) : ""}</div>${rg != null ? `<div class="reg">${money(rg)}</div>` : ""}</div>
        ${s.detail ? `<div class="detail">${esc(s.detail)}</div>` : ""}
        <div class="deal-actions">
          ${inList ? '<span class="meta">Déjà dans la liste</span>' : `<button class="link" data-addfrom="${s.id}" type="button">Ajouter à la liste</button>`}
          <button class="link muted" data-ignore="${s.id}" type="button">Masquer</button>
          ${/^https?:\/\//.test(s.lien || "") ? `<a href="${esc(s.lien)}" target="_blank" rel="noopener">Voir la circulaire</a>` : ""}
        </div></div>`;
    }).join("")}</div>`
      : emptyBox("Aucun spécial trouvé pour l'instant", surveilles().length ? `Aucun de vos ${surveilles().length} produits surveillés n'est en rabais dans les circulaires vérifiées.` : "Touchez l'étoile ★ d'un produit dans le Catalogue pour surveiller ses spéciaux.");

    renderProducts();
    renderMaison();
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
    $("#c-produits").textContent = state.prod.length;
    const q = norm(search);
    const nSurv = state.prod.filter((p) => p.surveiller).length, nMaison = state.prod.filter((p) => Number(p.stock || 0) > 0).length;
    $("#n-surv").textContent = nSurv; $("#n-maison").textContent = nMaison;
    document.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filtre)));
    const list = state.prod.filter((p) => (!q || norm([p.nom, p.marque, p.format, p.categorie].join(" ")).includes(q))
      && (filtre === "tous" || (filtre === "surv" && p.surveiller) || (filtre === "maison" && Number(p.stock || 0) > 0)));
    if (!state.prod.length) { $("#list-prod").innerHTML = emptyBox("Le catalogue est vide", "Ajoutez vos produits habituels ci-dessus, ou ajoutez simplement des articles à la liste : ils s'inscriront ici."); return; }
    if (!list.length) { $("#list-prod").innerHTML = filtre === "surv" && !q ? emptyBox("Aucun produit surveillé", "Touchez l'étoile ☆ à droite d'un produit pour que l'agent cherche ses spéciaux chaque jeudi.")
      : filtre === "maison" && !q ? emptyBox("Rien à la maison", "Les produits rangés dans un espace avec une réserve apparaîtront ici.")
      : emptyBox("Aucun produit trouvé", `Rien ne correspond à « ${esc(search)} ».`); return; }
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
          <div class="meta">${esc([p.marque, p.format, Number(p.stock || 0) > 0 ? fmtQ(p.stock) + " à la maison" : "", p.surveiller && p.prix_cible != null ? "cible " + money(Number(p.prix_cible)) : ""].filter(Boolean).join(" · ")) || "&nbsp;"}</div></div>
          <div class="best-price">${b ? money(b.val) + `<small>${esc(b.store)}</small>` : "<small>aucun prix</small>"}</div>
          <button class="star${p.surveiller ? " on" : ""}" type="button" data-survtoggle="${p.id}" aria-pressed="${p.surveiller ? "true" : "false"}" aria-label="${p.surveiller ? "Ne plus surveiller" : "Surveiller les spéciaux de"} ${esc(p.nom)}">${p.surveiller ? "★" : "☆"}</button>
          ${openProd === p.id ? productDetail(p, b) : ""}
        </li>`;
      }).join("")).join("")}</ul>`;
  }

  // ---------- maison : espaces et réserves
  const espacesTries = () => [...state.espaces].sort((a, b) => (a.ordre - b.ordre) || norm(a.nom).localeCompare(norm(b.nom)));
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
  async function approuver(r) {
    const nom = (r.nom || "").trim(); if (!nom) { status("Donnez un nom à l'article avant de l'approuver."); return false; }
    const qte = Number(r.quantite) > 0 ? Number(r.quantite) : 1;
    let p = (r.produit_id && state.prod.find((x) => x.id === r.produit_id)) || state.prod.find((x) => norm(x.nom) === norm(nom));
    if (!p) {
      const row = { nom, marque: r.marque || "", format: r.format || "", categorie: r.categorie || "Autre", espace_id: r.espace_id || null, stock: 0 };
      const { data, error } = await sb.from("produits").insert(row).select("*").single();
      if (error) { status("L'article n'a pas pu être ajouté. Réessayez."); console.error(error); return false; }
      p = data; state.prod.push(p);
    }
    const avant = Number(p.stock || 0);
    const per = r.peremption || null;
    const peremption = per && avant > 0 && p.peremption && p.peremption < per ? p.peremption : (per || (avant > 0 ? p.peremption : null));
    const maj = { stock: avant + qte, peremption };
    if (r.espace_id) maj.espace_id = r.espace_id;
    const { error } = await sb.from("produits").update(maj).eq("id", p.id);
    if (error) { status("L'article n'a pas pu être rangé. Réessayez."); console.error(error); return false; }
    Object.assign(p, maj);
    const pu = Number(r.prix_unitaire) > 0 ? Number(r.prix_unitaire) : (Number(r.prix_total) > 0 ? Number(r.prix_total) / qte : null);
    if (pu && r.magasin && stores().includes(r.magasin)) {
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
      const { data, error } = await sb.functions.invoke("lire-facture", { body: { images: imgs.map((i) => i.b64) } });
      if (error || !data || data.erreur) throw new Error((data && data.erreur) || "lecture");
      const arts = data.articles || [];
      if (!arts.length) { status("Aucun article n'a pu être lu sur cette photo. Reprenez-la bien à plat, avec un bon éclairage."); return; }
      const lot = crypto.randomUUID();
      const rows = arts.map((a) => ({ lot, magasin: data.magasin || "", date_achat: data.date || today(), texte: a.texte, produit_id: a.produit_id, nom: a.nom,
        marque: a.marque, format: a.format, categorie: a.categorie, quantite: a.quantite, prix_unitaire: a.prix_unitaire, prix_total: a.prix_total,
        espace_id: a.espace_id, peremption: a.peremption, confiance: a.confiance, photo: paths[0] }));
      if (await run(sb.from("panier").insert(rows), `${rows.length} article${rows.length > 1 ? "s" : ""} lu${rows.length > 1 ? "s" : ""} sur la facture${data.magasin ? " de " + data.magasin : ""}. Approuvez-les ci-dessous.`)) {
        await load("panier"); showView("maison"); render();
        $("#panier").scrollIntoView({ block: "start", behavior: "smooth" });
      }
    } catch (err) {
      console.error(err);
      status("La facture n'a pas pu être lue. Vérifiez votre connexion et réessayez, ou prenez une photo plus nette.");
    } finally { $("#lbl-facture").classList.remove("busy"); }
  });
  // ---------- bilan du soir (consommation)
  let bilanOuvert = false; const conso = {}; // id -> quantité consommée
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
    if (!bilanOuvert && !bilanDu()) { box.innerHTML = ""; return; }
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
      <p class="hint">Pour chaque produit : −1 unité, −25 % ou −50 % d'un emballage, ou « Tout ». Vous pouvez aussi inscrire une quantité (0,3 = 30 %).</p>
      ${items.length ? `<ul class="list">${items.map((p) => {
        const e = state.espaces.find((x) => x.id === p.espace_id);
        const head = (e ? e.nom : "Sans espace") !== espCourant ? (espCourant = e ? e.nom : "Sans espace", `<li class="cat-head" style="display:block">${esc(espCourant)}</li>`) : "";
        const c = conso[p.id] || 0, reste = Math.max(0, Number(p.stock) - c);
        return head + `<li class="bilan-item${c > 0 ? " touched" : ""}">
          ${thumb(p.photo, p.nom)}
          <div class="main"><div class="name">${esc(p.nom)}</div>
            <div class="meta">${c > 0 ? `<b>−${fmtQ(c)}</b> · il restera ${fmtQ(reste)}` : `${fmtQ(p.stock)} à la maison`}${expTag(p) ? " · " + expTag(p) : ""}</div></div>
          <div class="bilan-ctl">
            <button class="chip-btn" type="button" data-conso="1" data-id="${p.id}">−1</button>
            <button class="chip-btn" type="button" data-conso="0.25" data-id="${p.id}">−25 %</button>
            <button class="chip-btn" type="button" data-conso="0.5" data-id="${p.id}">−50 %</button>
            <button class="chip-btn" type="button" data-conso="tout" data-id="${p.id}">Tout</button>
            <input class="bilan-in" inputmode="decimal" aria-label="Quantité consommée de ${esc(p.nom)}" placeholder="autre" value="${c > 0 ? esc(fmtQ(c)) : ""}" data-consoin="${p.id}">
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
    await run(sb.from("config").update({ dernier_bilan: auj }).eq("id", 1));
  }
  async function enregistrerBilan() {
    const ids = Object.keys(conso).filter((id) => conso[id] > 0);
    $("#bilan-ok").disabled = true;
    for (const id of ids) await ajusterStock(id, -conso[id]);
    ids.forEach((id) => delete conso[id]);
    await marquerBilanFait();
    bilanOuvert = false; render();
    status(ids.length ? `Bilan enregistré : ${ids.length} produit${ids.length > 1 ? "s" : ""} mis à jour.` : "Bilan enregistré : rien consommé aujourd'hui.");
  }
  $("#bilan").addEventListener("click", async (e) => {
    if (e.target.closest("#bilan-go")) return ouvrirBilan();
    if (e.target.closest("#bilan-rien")) { await marquerBilanFait(); render(); status("Noté : rien consommé aujourd'hui."); return; }
    if (e.target.closest("#bilan-fermer")) { bilanOuvert = false; render(); return; }
    if (e.target.closest("#bilan-ok")) return enregistrerBilan();
    const b = e.target.closest("[data-conso]"); if (!b) return;
    const p = state.prod.find((x) => x.id === b.dataset.id); if (!p) return;
    const v = b.dataset.conso, stock = Number(p.stock || 0), avant = conso[p.id] || 0;
    conso[p.id] = v === "tout" ? stock : v === "0" ? 0 : Math.min(stock, Math.round((avant + Number(v)) * 100) / 100);
    renderBilan();
  });
  $("#bilan").addEventListener("change", (e) => {
    const i = e.target.closest("[data-consoin]"); if (!i) return;
    const p = state.prod.find((x) => x.id === i.dataset.consoin); if (!p) return;
    let raw = i.value.trim().replace("%", "").trim(), v = num(raw);
    if (raw && v == null) { status("Inscrivez un nombre, par exemple 1 ou 0,5."); return; }
    if (v != null && /%/.test(i.value)) v = v / 100;
    conso[p.id] = Math.max(0, Math.min(Number(p.stock || 0), v || 0));
    i.blur(); renderBilan();
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
    if (open) { $("#help").hidden = true; $("#membres").hidden = true; etatRappel(); $("#rappel").scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  $("#open-rappel").addEventListener("click", async () => {
    if (!rappelActif && peutNotifier()) { await activerRappel(); if (!rappelActif) showRappel(true); return; }
    showRappel($("#rappel").hidden);
  });
  $("#close-rappel").addEventListener("click", () => showRappel(false));

  function renderMaison() {
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
              <span class="hint">« Il n'y en a plus » le sort de la Maison mais le garde dans le Catalogue (prix, photo, espace habituel). « Supprimer complètement » l'efface du Catalogue aussi.</span></div>` : ""}</li>`).join("")}</ul>`
          : `<p class="hint espace-vide">Rien en réserve ici pour l'instant.</p>`}
        </div>`;
      }).join("") || emptyBox("Aucun produit trouvé", `Rien ne correspond à « ${esc($("#in-msearch").value)} ».`);
    }
    const sans = state.prod.filter((p) => !p.espace_id && Number(p.stock || 0) > 0 && match(p)).sort((a, b) => norm(a.nom).localeCompare(norm(b.nom)));
    $("#sans-espace-count").textContent = sans.length;
    $("#list-sans-espace").innerHTML = sans.length
      ? `<ul class="list" data-keep>${sans.map((p) => `<li class="sans-row">${thumb(p.photo, p.nom)}<div class="main"><div class="name">${esc(p.nom)}</div>
          <div class="meta">${esc([p.format, Number(p.stock || 0) > 0 ? fmtQ(p.stock) + " à la maison" : ""].filter(Boolean).join(" · "))}</div></div>
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
    await run(sb.from("produits").update(apres === 0 ? { stock: 0, peremption: null } : { stock: apres }).eq("id", id));
    if (delta < 0 && estBas(p) && !(avant <= Number(p.minimum))) {
      if (!state.liste.some((i) => !i.fait && norm(i.nom) === norm(p.nom))) {
        if (await run(sb.from("epicerie").insert({ nom: p.nom, ...(p.photo ? { photo: p.photo } : {}) }), `« ${p.nom} » est sous le minimum : ajouté à la liste.`)) scheduleReload("epicerie");
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
        <label class="mf">En réserve ${stockCtl(p)}</label>
        <label class="mf">Prix cible (spéciaux) <input id="e-cible-${pid}" inputmode="decimal" placeholder="Tout rabais" value="${p.prix_cible != null ? esc(String(p.prix_cible).replace(".", ",")) : ""}" data-nfield="prix_cible" data-id="${pid}"></label>
        <label class="mf">Péremption <input type="date" id="e-per-${pid}" value="${esc(p.peremption || "")}" data-dfield="peremption" data-id="${pid}"></label>
        <label class="mf">Minimum à garder <input id="e-min-${pid}" inputmode="decimal" placeholder="Aucun" value="${p.minimum != null ? esc(fmtQ(p.minimum)) : ""}" data-nfield="minimum" data-id="${pid}"></label>
      </div>
      <div class="price-grid">${stores().map((s, ix) => {
        const e = (p.prix && p.prix[s]) || {}; const pr = priceAt(p, s);
        return `<div class="pcell${b && b.store === s ? " best" : ""}"><label for="pr-${pid}-${ix}">${esc(s)}</label>
          <input id="pr-${pid}-${ix}" inputmode="decimal" placeholder="Prix régulier" value="${e.reg != null ? esc(String(e.reg)) : ""}" data-price="${esc(s)}" data-id="${pid}">
          ${pr && pr.special ? `<span class="sp">Spécial ${money(pr.val)}${pr.fin ? ` · ${fmtDate(pr.fin)}` : ""}</span>` : ""}
          ${e.maj ? `<span class="when">maj ${fmtDate(e.maj)}${e.par === "agent" ? " · agent" : ""}</span>` : ""}
        </div>`;
      }).join("")}</div>
      <div class="row-actions">
        <button class="link" type="button" data-tolist="${pid}">Ajouter à la liste</button>
        <button class="link" type="button" data-survtoggle="${pid}">${p.surveiller ? "★ Ne plus surveiller" : "☆ Surveiller les spéciaux"}</button>
        <button class="link muted" type="button" data-del="produits" data-id="${pid}">Supprimer du catalogue</button>
      </div>
    </div>`;
  }

  // ---------- data
  const TABLES = { epicerie: "liste", speciaux: "spec", produits: "prod", espaces: "espaces", panier: "panier" };
  async function load(table) {
    if (table === "membres") {
      const { data } = await sb.from("membres").select("id, email, telephone, nom, invite_par");
      if (data) state.membres = data;
      renderMembres(); return;
    }
    if (table === "config") {
      const { data } = await sb.from("config").select("*").eq("id", 1).maybeSingle();
      state.config = data; return;
    }
    const { data, error } = await sb.from(table).select("*").order("cree", { ascending: true, nullsFirst: true }).limit(2000);
    if (error && table === "speciaux") { const r = await sb.from(table).select("*").limit(2000); state[TABLES[table]] = r.data || []; return; }
    if (!error) state[TABLES[table]] = data || [];
  }
  async function loadAll() {
    await Promise.all(["epicerie", "produits", "espaces", "panier", "config"].map(load).concat(
      sb.from("speciaux").select("*").limit(2000).then(({ data }) => { state.spec = data || []; })));
    render();
  }
  const pending = {};
  function scheduleReload(table) {
    clearTimeout(pending[table]);
    pending[table] = setTimeout(async () => {
      if (table === "speciaux") { const { data } = await sb.from("speciaux").select("*").limit(2000); state.spec = data || []; }
      else await load(table);
      render();
    }, 250);
  }
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("epicerie-live");
    ["epicerie", "speciaux", "produits", "espaces", "panier", "config", "membres"].forEach((t) =>
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
      const maj = {};
      if (ex.photo && !p.photo) maj.photo = ex.photo;
      if (ex.marque && !p.marque) maj.marque = ex.marque;
      if (ex.format && !p.format) maj.format = ex.format;
      if (ex.categorie && ex.categorie !== "Autre" && (!p.categorie || p.categorie === "Autre")) maj.categorie = ex.categorie;
      if (Object.keys(maj).length) { await run(sb.from("produits").update(maj).eq("id", p.id)); scheduleReload("produits"); }
      return;
    }
    const row = { nom };
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
      return `<li class="membre-row"><div class="main"><div class="name">${esc(lib(x))}${moi ? ' <span class="meta">(vous)</span>' : ""}</div>
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
    if (open) { $("#help").hidden = true; $("#rappel").hidden = true; renderMembres(); $("#membres").scrollIntoView({ block: "start", behavior: "smooth" }); }
  }
  $("#open-membres").addEventListener("click", () => showMembres($("#membres").hidden));
  $("#close-membres").addEventListener("click", () => showMembres(false));
  let inviteMsg = "";
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
    inviteMsg = `${nom ? "Salut " + nom + "! " : ""}${moi ? moi + " t'invite" : "Je t'invite"} à partager notre liste d'épicerie. Ouvre ${APP_URL}, touche « Créer mon compte » et entre ton cellulaire ${fmtTel(tel)} : tu recevras un code par texto, puis tu choisiras ton mot de passe.`;
    $("#invite-text").textContent = `${nom || fmtTel(tel)} a accès. Envoyez-lui ce message pour qu'elle ou il crée son compte :\n\n« ${inviteMsg} »`;
    $("#invite-send").hidden = !navigator.share;
    $("#invite-share").hidden = false;
    status("");
    await load("membres");
  });
  $("#invite-send").addEventListener("click", async () => {
    try { await navigator.share({ title: "Notre épicerie", text: inviteMsg }); } catch (e) {}
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
    if (estMoi(cible)) { await sb.auth.signOut(); return; }
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

  // ---------- aide
  function showHelp(open) {
    $("#help").hidden = !open;
    if (open) { $("#membres").hidden = true; $("#rappel").hidden = true; }
    if (open) { $("#help").scrollIntoView({ block: "start", behavior: "smooth" }); }
    else { try { localStorage.setItem("aide-vue", "1"); } catch (e) {} }
  }
  $("#open-help").addEventListener("click", () => showHelp($("#help").hidden));
  $("#close-help").addEventListener("click", () => showHelp(false));
  $("#close-help-2").addEventListener("click", () => showHelp(false));
  function helpFirstTime() {
    let vue = false;
    try { vue = localStorage.getItem("aide-vue") === "1"; } catch (e) {}
    if (!vue) $("#help").hidden = false;
  }

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
    if (await run(sb.from("espaces").insert({ nom, ordre }), `Espace « ${nom} » créé.`)) scheduleReload("espaces");
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
    if (await run(sb.from("epicerie").insert(ph ? { nom, qte, photo: ph } : { nom, qte }))) {
      scheduleReload("epicerie");
      ensureProduct(nom, ph ? { photo: ph, ...(sameAsIdent ? { marque: id.marque, format: id.format, categorie: id.categorie } : {}) } : null);
    }
  });
  $("#f-store").addEventListener("submit", async (e) => {
    e.preventDefault(); const m = $("#in-store").value.trim(); if (!m) return;
    const cur = stores(); $("#in-store").value = "";
    if (cur.some((x) => norm(x) === norm(m))) return;
    if (await run(sb.from("config").update({ magasins: [...cur, m] }).eq("id", 1))) scheduleReload("config");
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
    if (!catPhoto) return;
    const nom = $("#in-pnom").value.trim(), b = $("#ppending-add");
    b.disabled = catPhoto.busy || !nom;
    b.textContent = catPhoto.busy ? "Identification…" : nom ? `Ajouter « ${nom} » au catalogue` : "Écrivez le nom ci-dessus";
  }
  $("#in-pnom").addEventListener("input", majCatBtn);
  $("#ppending-add").addEventListener("click", () => $("#f-prod").requestSubmit());
  $("#ppending-cancel").addEventListener("click", () => {
    if (catPhoto && catPhoto.path) sb.storage.from("photos").remove([catPhoto.path]);
    if (catPhoto && catPhoto.ident && $("#in-pnom").value.trim() === catPhoto.ident.nom) { $("#in-pnom").value = ""; $("#in-pformat").value = ""; }
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
        if (!$("#in-pnom").value.trim()) $("#in-pnom").value = ident.nom;
        if (!$("#in-pformat").value.trim() && ident.format) $("#in-pformat").value = ident.format;
        if (ident.categorie && CATS.includes(ident.categorie)) $("#in-pcat").value = ident.categorie;
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

  $("#f-prod").addEventListener("submit", async (e) => {
    e.preventDefault(); const nom = $("#in-pnom").value.trim(); if (!nom) return;
    if (catPhoto && catPhoto.busy) { status("Un instant, la photo est en cours d'envoi."); return; }
    const format = $("#in-pformat").value.trim(), categorie = $("#in-pcat").value;
    const ph = catPhoto && catPhoto.path, id = (catPhoto && catPhoto.ident) || {};
    const existant = state.prod.find((p) => norm(p.nom) === norm(nom));
    if (existant) {
      if (ph && !existant.photo) {
        if (await run(sb.from("produits").update({ photo: ph }).eq("id", existant.id), `« ${nom} » était déjà dans le catalogue : photo ajoutée.`)) scheduleReload("produits");
      } else status(`« ${nom} » est déjà dans le catalogue.`);
      showCatPhoto(null); $("#in-pnom").value = ""; $("#in-pformat").value = ""; return;
    }
    const row = { nom, format, categorie };
    if (ph) { row.photo = ph; if (id.marque && norm(id.nom) === norm(nom)) row.marque = id.marque; }
    $("#in-pnom").value = ""; $("#in-pformat").value = ""; $("#in-pcat").value = "Autre"; showCatPhoto(null); focusIfDesktop($("#in-pnom"));
    if (await run(sb.from("produits").insert(row), `« ${nom} » ajouté au catalogue.`)) scheduleReload("produits");
  });
  $("#in-search").addEventListener("input", (e) => { search = e.target.value; renderProducts(); });

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
      await run(sb.from("produits").update({ peremption: v }).eq("id", df.dataset.id), v ? "Date de péremption enregistrée." : "");
      scheduleReload("produits"); return;
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
      if (pf.dataset.pfield === "espace_id") v = v || null;
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
      await run(sb.from("produits").update({ peremption: null }).eq("id", dcl.dataset.dateclear)); return; }
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
      if (await run(sb.from("produits").update({ stock: 0, peremption: null }).eq("id", p.id), `« ${p.nom} » est épuisé; il reste dans le Catalogue.`)) scheduleReload("produits");
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
      if (await run(sb.from("produits").update({ espace_id: dest }).eq("id", p.id), `« ${p.nom} » déplacé vers ${nomDest}.`)) scheduleReload("produits");
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
      const enListe = new Set(state.liste.filter((i) => !i.fait).map((i) => norm(i.nom)));
      const rows = state.prod.filter((p) => estBas(p) && !enListe.has(norm(p.nom))).map((p) => ({ nom: p.nom, ...(p.photo ? { photo: p.photo } : {}) }));
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
      if (await run(sb.from("config").update({ magasins: cur }).eq("id", 1))) scheduleReload("config"); return;
    }
    const a = e.target.closest("[data-addfrom]");
    if (a) { const s = state.spec.find((x) => x.id === a.dataset.addfrom); if (s && await run(sb.from("epicerie").insert({ nom: s.item }))) scheduleReload("epicerie"); return; }
    const ig = e.target.closest("[data-ignore]");
    if (ig) { local("speciaux", () => (state.spec = state.spec.filter((x) => x.id !== ig.dataset.ignore))); await run(sb.from("speciaux").update({ ignore: true }).eq("id", ig.dataset.ignore)); return; }
    const tl = e.target.closest("[data-tolist]");
    if (tl) {
      const p = state.prod.find((x) => x.id === tl.dataset.tolist); if (!p) return;
      if (state.liste.some((i) => !i.fait && norm(i.nom) === norm(p.nom))) { status(`« ${p.nom} » est déjà dans la liste.`); return; }
      if (await run(sb.from("epicerie").insert({ nom: p.nom }), `« ${p.nom} » ajouté à la liste.`)) scheduleReload("epicerie"); return;
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
  $("#clear-done").addEventListener("click", async () => {
    const ids = state.liste.filter((i) => i.fait).map((i) => i.id);
    if (!ids.length) return;
    local("epicerie", () => (state.liste = state.liste.filter((i) => !i.fait)));
    await run(sb.from("epicerie").delete().in("id", ids));
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.email) loadAll(); });

  // ---------- auth (comme Le 19e : cellulaire + code texto pour créer le compte, puis mot de passe)
  let pendingEmail = "", pendingTel = "";
  const loginStatus = (m) => { $("#login-status").textContent = m || ""; };
  const loginForms = ["#f-login", "#f-sms", "#f-smscode"];
  function loginView(id) { loginForms.forEach((f) => ($(f).hidden = f !== id)); $("#alt-login").hidden = id !== "#f-login"; loginStatus(""); }
  function ouvrirSms(mode) {
    $("#sms-title").textContent = mode === "oubli" ? "Nouveau mot de passe" : "Créer mon compte";
    $("#sms-intro").textContent = mode === "oubli"
      ? "Entrez votre cellulaire. Vous recevrez un code par texto pour choisir un nouveau mot de passe."
      : "Entrez votre cellulaire. Vous recevrez un code par texto, puis vous choisirez votre mot de passe.";
    if ($("#in-tel").value.trim()) $("#in-tel2").value = $("#in-tel").value.trim();
    loginView("#f-sms"); $("#in-tel2").focus();
  }
  $("#go-creer").addEventListener("click", () => ouvrirSms("creer"));
  $("#go-oubli").addEventListener("click", () => ouvrirSms("oubli"));
  document.querySelectorAll("[data-back-login]").forEach((b) => b.addEventListener("click", () => loginView("#f-login")));

  $("#f-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = e164($("#in-tel").value), password = $("#in-pw").value;
    if (!phone) { loginStatus("Entrez votre cellulaire à 10 chiffres, par exemple 514 555-1234."); return; }
    loginStatus("Connexion…");
    const { error } = await sb.auth.signInWithPassword({ phone, password });
    if (error) {
      loginStatus(/rate|too many/i.test(error.message || "") ? "Trop d'essais. Réessayez dans quelques minutes, ou touchez « Mot de passe oublié ? »."
        : "Cellulaire ou mot de passe incorrect. Première fois ? Touchez « Créer mon compte ».");
      return;
    }
    $("#in-pw").value = ""; loginStatus("");
  });
  $("#f-sms").addEventListener("submit", async (e) => {
    e.preventDefault();
    pendingTel = e164($("#in-tel2").value);
    if (!pendingTel) { loginStatus("Entrez votre cellulaire à 10 chiffres, par exemple 514 555-1234."); return; }
    loginStatus("Vérification du numéro…");
    const { data: inscrit, error: e0 } = await sb.rpc("cellulaire_inscrit", { tel: pendingTel });
    if (e0) { loginStatus("Le service est injoignable. Vérifiez votre connexion et réessayez."); return; }
    if (!inscrit) { loginStatus(`Le ${fmtTel(pendingTel)} n'est pas inscrit. Demandez à un membre de l'ajouter dans « Membres ».`); return; }
    loginStatus("Envoi du code par texto…");
    const { error } = await sb.auth.signInWithOtp({ phone: pendingTel, options: { shouldCreateUser: true, channel: "sms" } });
    if (error) {
      console.error(error);
      loginStatus(/provider|sms|twilio|disabled|unsupported/i.test(error.message || "") ? "L'envoi de textos n'est pas encore configuré. Utilisez « Se connecter avec un code par courriel » en attendant."
        : /rate|seconds/i.test(error.message || "") ? "Un code vient d'être envoyé. Attendez une minute avant d'en demander un autre."
        : "Le texto n'a pas pu être envoyé. Réessayez dans une minute.");
      return;
    }
    $("#smscode-hint").textContent = `Entrez le code envoyé par texto au ${fmtTel(pendingTel)}.`;
    loginView("#f-smscode"); $("#in-smscode").focus();
  });
  $("#f-smscode").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = chiffres($("#in-smscode").value), pw = $("#in-newpw").value;
    if (token.length !== 6) { loginStatus("Entrez le code à 6 chiffres reçu par texto."); return; }
    if (pw.length < 6) { loginStatus("Le mot de passe doit avoir au moins 6 caractères."); return; }
    loginStatus("Vérification…");
    const { error } = await sb.auth.verifyOtp({ phone: pendingTel, token, type: "sms" });
    if (error) { loginStatus("Ce code ne fonctionne pas ou a expiré. Vérifiez-le ou touchez « Retour » pour en demander un autre."); return; }
    const { error: e2 } = await sb.auth.updateUser({ password: pw });
    if (e2) { status("Vous êtes connecté, mais le mot de passe n'a pas été enregistré. Utilisez « Mot de passe oublié ? » plus tard."); }
    else status("Compte prêt : la prochaine fois, connectez-vous avec votre cellulaire et ce mot de passe.");
    $("#in-smscode").value = ""; $("#in-newpw").value = ""; $("#in-tel").value = fmtTel(pendingTel); loginStatus("");
  });

  // Secours : code par courriel
  $("#f-email").addEventListener("submit", async (e) => {
    e.preventDefault();
    pendingEmail = $("#in-email").value.trim().toLowerCase(); if (!pendingEmail) return;
    loginStatus("Envoi du code…");
    const { error } = await sb.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true } });
    if (error) { loginStatus("Le code n'a pas pu être envoyé. Attendez une minute et réessayez."); console.error(error); return; }
    loginStatus("");
    $("#code-hint").textContent = `Entrez le code envoyé à ${pendingEmail}.`;
    $("#f-email").hidden = true; $("#f-code").hidden = false; $("#in-code").focus();
  });
  $("#f-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("#in-code").value.replace(/\s/g, "");
    loginStatus("Vérification…");
    const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
    if (error) { loginStatus("Ce code ne fonctionne pas ou a expiré. Vérifiez-le ou demandez-en un nouveau."); return; }
    loginStatus("");
  });
  $("#back-email").addEventListener("click", () => { $("#f-code").hidden = true; $("#f-email").hidden = false; $("#in-code").value = ""; loginStatus(""); });
  $("#logout").addEventListener("click", () => sb.auth.signOut());

  async function onSession(session) {
    if (!session) {
      state.email = null; state.userEmail = null; state.userPhone = null;
      if (channel) { sb.removeChannel(channel); channel = null; }
      $("#app").hidden = true; $("#login").hidden = false;
      $("#f-code").hidden = true; $("#f-email").hidden = false;
      if ($("#f-smscode").hidden && $("#f-sms").hidden) loginView("#f-login");
      return;
    }
    state.userEmail = session.user.email || null;
    state.userPhone = session.user.phone || null;
    state.email = state.userEmail || state.userPhone;
    const { data: membres } = await sb.from("membres").select("id, email, telephone, nom, invite_par");
    if (!membres || !membres.length) {
      $("#login").hidden = false; $("#app").hidden = true; loginView("#f-login");
      loginStatus(`${state.userPhone ? "Le " + fmtTel(state.userPhone) : "L'adresse " + state.userEmail} n'a pas accès à cette liste. Demandez à un membre de l'ajouter dans « Membres ».`);
      await sb.auth.signOut({ scope: "local" });
      return;
    }
    state.membres = membres;
    const me = membres.find(estMoi);
    $("#who").textContent = (me && me.nom) || (state.userPhone ? fmtTel(state.userPhone) : state.userEmail);
    $("#login").hidden = true; $("#app").hidden = false;
    helpFirstTime();
    await loadAll();
    etatRappel().catch(() => {});
    if (location.hash === "#bilan") ouvrirBilan();
    subscribe();
  }
  let current, started = false;
  sb.auth.onAuthStateChange((evt, session) => {
    const ident = (session && session.user && (session.user.id)) || null;
    if (started && ident === current && evt !== "SIGNED_OUT") return;
    started = true;
    current = ident;
    setTimeout(() => onSession(session), 0);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
