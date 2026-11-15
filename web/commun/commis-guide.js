// Le Commis en personne : une jeune assistante dessinée, très organisée, qui fait visiter les concepts de l'app, étape par étape.
// Partagé par le site (lecommis.ai) et l'app (app.lecommis.ai) : servi à /commun/ sur les deux adresses.
//   CommisGuide.ouvrir({ etapes: [{ titre, texte, puce?, icone? }], fin: { titre, texte, bouton, action }, onFermer })
//   CommisGuide.avatar(taille) → le SVG du personnage
(function () {
  "use strict";

  const AVATAR = `<svg class="cg-av" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
  <circle cx="100" cy="100" r="98" fill="#DCEBDF"/>
  <clipPath id="cg-clip"><circle cx="100" cy="100" r="98"/></clipPath>
  <g clip-path="url(#cg-clip)">
    <path d="M30 200 C32 160 60 142 100 142 C140 142 168 160 170 200 Z" fill="#1F5B3A"/>
    <path d="M84 142 L100 172 L116 142 Z" fill="#F4EFE3"/>
    <path d="M84 142 L94 166 L86 200 M116 142 L106 166 L114 200" stroke="#174A2F" stroke-width="3" fill="none" stroke-linejoin="round"/>
    <g transform="translate(118 160) rotate(-8)"><path d="M0 6 L5 0 H18 V12 H5 Z" fill="#F2C230"/><circle cx="5.5" cy="6" r="1.6" fill="#1F5B3A"/></g>
    <g class="cg-bras"><path d="M164 200 C166 178 170 162 176 148" stroke="#1F5B3A" stroke-width="22" stroke-linecap="round" fill="none"/><circle cx="178" cy="140" r="11" fill="#D7A07C"/></g>
    <g transform="translate(36 150) rotate(-10)">
      <rect x="0" y="0" width="40" height="52" rx="4" fill="#B98A5A"/>
      <rect x="4" y="6" width="32" height="42" rx="2" fill="#fff"/>
      <rect x="13" y="-3" width="14" height="7" rx="2" fill="#59635C"/>
      <path d="M8 15 l2.5 2.5 l4.5 -5 M8 25 l2.5 2.5 l4.5 -5 M8 35 l2.5 2.5 l4.5 -5" stroke="#1F5B3A" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M19 15 H31 M19 25 H31 M19 35 H28" stroke="#C9CFC6" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="40" cy="30" r="9" fill="#D7A07C"/>
    </g>
    <path d="M89 120 H111 V144 C105 149 95 149 89 144 Z" fill="#C88F6C"/>
    <g transform="rotate(-4 100 130)"><g class="cg-tete">
      <circle cx="100" cy="42" r="15" fill="#3B2418"/>
      <path d="M64 96 C60 62 78 50 100 50 C122 50 140 62 136 96 C134 84 128 74 120 70 C108 76 88 74 78 70 C70 76 66 86 64 96 Z" fill="#3B2418"/>
      <path d="M66 92 C62 110 66 124 72 130 L76 104 Z M134 92 C138 110 134 124 128 130 L124 104 Z" fill="#3B2418"/>
      <ellipse cx="100" cy="94" rx="33" ry="37" fill="#D7A07C"/>
      <path d="M67 84 C70 66 84 58 100 58 C116 58 130 66 133 84 C124 72 110 66 98 70 C88 66 76 72 67 84 Z" fill="#3B2418"/>
      <circle cx="67" cy="103" r="3" fill="#F2C230"/><circle cx="133" cy="103" r="3" fill="#F2C230"/>
      <ellipse cx="79" cy="109" rx="7.5" ry="5.5" fill="#E9806F" opacity=".55"/><ellipse cx="121" cy="109" rx="7.5" ry="5.5" fill="#E9806F" opacity=".55"/>
      <g class="cg-yeux"><ellipse cx="87" cy="96" rx="4.6" ry="5" fill="#1D2520"/><ellipse cx="113" cy="96" rx="4.6" ry="5" fill="#1D2520"/>
        <circle cx="88.8" cy="94" r="1.6" fill="#fff"/><circle cx="114.8" cy="94" r="1.6" fill="#fff"/>
        <path d="M81.5 100.5 Q87 104.5 92.5 100.5 M107.5 100.5 Q113 104.5 118.5 100.5" stroke="#D7A07C" stroke-width="3.2" fill="none" stroke-linecap="round"/></g>
      <path d="M81.5 91 L79.6 89 M118.5 91 L120.4 89" stroke="#1D2520" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M80.5 83.5 Q87 79.5 93.5 82.5 M106.5 82.5 Q113 79.5 119.5 83.5" stroke="#3B2418" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M100 100 Q102.5 105.5 99 107" stroke="#B57B58" stroke-width="2" fill="none" stroke-linecap="round"/>
      <g class="cg-bouche"><path d="M88 113 Q100 129 112 113 Q100 117 88 113 Z" fill="#8E2F36"/>
        <path d="M90.5 114 Q100 117.5 109.5 114 L108.6 117 Q100 119.4 91.4 117 Z" fill="#fff"/>
        <path d="M95 123 Q100 125.2 105 123" stroke="#E9806F" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
    </g></g>
  </g>
</svg>`;

  // Petites icônes des concepts (trait, couleur courante)
  const ICONES = {
    produits: '<path d="M4 9l8-5 8 5v10H4z"/><path d="M9 19v-6h6v6"/>',
    lieu: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    liste: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    speciaux: '<path d="M3 12l9-9h8v8l-9 9z"/><circle cx="16" cy="8" r="1.6"/>',
    facture: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    soir: '<path d="M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z"/>',
    bonjour: '<path d="M7 11V5a2 2 0 0 1 4 0v5M11 10V4a2 2 0 0 1 4 0v6M15 9V6a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.5L3 14a2 2 0 0 1 3.4-2L7 13"/>',
  };
  const icone = (k) => ICONES[k] ? `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[k]}</svg>` : "";

  const CSS = `
.cg-fond{position:fixed;inset:0;z-index:1000;background:rgba(14,32,22,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px;animation:cg-in .2s ease-out}
@media (min-width:700px){.cg-fond{align-items:center}}
.cg-boite{width:100%;max-width:560px;background:#F6F5EF;color:#1D2520;border-radius:22px;padding:22px 22px 18px;box-shadow:0 20px 50px rgba(0,0,0,.3);font-family:'Familjen Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;max-height:calc(100vh - 32px);overflow:auto}
.cg-haut{display:grid;grid-template-columns:136px 1fr;gap:16px;align-items:end}
@media (max-width:420px){.cg-haut{grid-template-columns:108px 1fr;gap:10px}}
.cg-av{width:100%;height:auto;display:block}
.cg-bulle{position:relative;background:#fff;border:1.5px solid #DCDFD8;border-radius:16px 16px 16px 4px;padding:14px 16px;min-height:96px}
.cg-bulle::before{content:"";position:absolute;left:-9px;bottom:10px;width:14px;height:14px;background:#fff;border-left:1.5px solid #DCDFD8;border-bottom:1.5px solid #DCDFD8;transform:rotate(45deg)}
.cg-puce{display:inline-flex;align-items:center;gap:6px;font:600 11px 'DM Mono',ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:#1F5B3A;background:#DCEBDF;border-radius:999px;padding:4px 10px 4px 8px;margin:0 0 8px}
.cg-titre{font-family:'Bricolage Grotesque','Familjen Grotesk',system-ui,sans-serif;font-weight:800;font-size:22px;line-height:1.1;letter-spacing:-.01em;margin:0 0 6px}
.cg-texte{margin:0;font-size:16.5px;line-height:1.5}
.cg-points{display:flex;gap:6px;justify-content:center;margin:16px 0 12px}
.cg-points span{width:8px;height:8px;border-radius:50%;background:#C9CFC6}
.cg-points span.on{background:#1F5B3A;width:22px;border-radius:999px}
.cg-actions{display:flex;align-items:center;gap:10px}
.cg-actions .cg-plein{margin-left:auto}
.cg-btn{font:600 16px 'Familjen Grotesk',system-ui,sans-serif;border-radius:10px;min-height:46px;padding:0 18px;cursor:pointer;border:1.5px solid #1F5B3A;background:#fff;color:#1F5B3A}
.cg-btn.cg-plein{background:#1F5B3A;color:#fff}
.cg-btn.cg-jaune{background:#F2C230;border-color:#F2C230;color:#2A2000}
.cg-btn:focus-visible,.cg-lien:focus-visible{outline:3px solid #F2C230;outline-offset:2px}
.cg-lien{background:none;border:0;color:#59635C;font:500 15px 'Familjen Grotesk',system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:6px 2px}
.cg-yeux{transform-origin:100px 96px;animation:cg-cligne 4.5s infinite}
.cg-parle .cg-bouche{transform-origin:100px 116px;animation:cg-parle .22s ease-in-out infinite alternate}
.cg-salue .cg-bras{transform-origin:170px 175px;animation:cg-salue .5s ease-in-out 3 alternate}
.cg-tete{transform-origin:100px 130px;animation:cg-hoche 3.2s ease-in-out infinite}
@keyframes cg-cligne{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes cg-parle{from{transform:scaleY(.75)}to{transform:scaleY(1.2)}}
@keyframes cg-salue{from{transform:rotate(0)}to{transform:rotate(-14deg)}}
@keyframes cg-hoche{0%,100%{transform:rotate(0)}50%{transform:rotate(1.5deg)}}
@keyframes cg-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.cg-yeux,.cg-tete,.cg-parle .cg-bouche,.cg-salue .cg-bras,.cg-fond{animation:none}}
.cg-lanceur{position:fixed;right:16px;bottom:16px;z-index:900;display:flex;align-items:flex-end;gap:8px;max-width:calc(100vw - 32px)}
.cg-lanceur .cg-mini{width:72px;height:72px;border-radius:50%;border:3px solid #fff;box-shadow:0 6px 18px rgba(0,0,0,.25);background:#DCEBDF;padding:0;cursor:pointer;flex:none;overflow:hidden}
.cg-lanceur .cg-mini svg{width:100%;height:100%}
.cg-lanceur[hidden],.cg-lanceur .cg-dit[hidden]{display:none}
body:has(.cg-fond) .cg-lanceur{display:none}
.cg-lanceur{padding-bottom:env(safe-area-inset-bottom)}
@media (max-width:520px){.cg-lanceur .cg-mini{width:60px;height:60px}}
@media print{.cg-lanceur{display:none}}
.cg-lanceur .cg-dit{background:#fff;color:#1D2520;border-radius:14px 14px 4px 14px;padding:10px 12px;box-shadow:0 6px 18px rgba(0,0,0,.18);font:500 15px 'Familjen Grotesk',system-ui,sans-serif;max-width:240px;position:relative}
.cg-lanceur .cg-dit b{display:block}
.cg-lanceur .cg-dit button.cg-go{all:unset;cursor:pointer;color:#1F5B3A;font-weight:600;text-decoration:underline;margin-top:4px;display:inline-block}
.cg-lanceur .cg-ferme{position:absolute;top:-8px;right:-8px;width:24px;height:24px;border-radius:50%;border:0;background:#1D2520;color:#fff;font-size:13px;cursor:pointer;line-height:24px;padding:0}
`;

  let styleOk = false;
  function style() {
    if (styleOk) return; styleOk = true;
    const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }

  function ouvrir(opts) {
    style();
    const etapes = (opts.etapes || []).slice();
    if (opts.fin) etapes.push(Object.assign({ estFin: true }, opts.fin));
    let i = 0, minuterie = null;
    const avant = document.activeElement;
    const fond = document.createElement("div");
    fond.className = "cg-fond";
    fond.innerHTML = `<div class="cg-boite" role="dialog" aria-modal="true" aria-labelledby="cg-titre">
      <div class="cg-haut"><div class="cg-perso cg-salue">${AVATAR}</div>
        <div class="cg-bulle" aria-live="polite"><div class="cg-contenu"></div></div></div>
      <div class="cg-points" aria-hidden="true">${etapes.map(() => "<span></span>").join("")}</div>
      <div class="cg-actions">
        <button type="button" class="cg-lien" data-cg="passer">Passer la visite</button>
        <button type="button" class="cg-btn" data-cg="prec">Précédent</button>
        <button type="button" class="cg-btn cg-plein" data-cg="suiv">Suivant</button>
      </div></div>`;
    document.body.appendChild(fond);
    const perso = fond.querySelector(".cg-perso"), contenu = fond.querySelector(".cg-contenu");
    const bPrec = fond.querySelector('[data-cg="prec"]'), bSuiv = fond.querySelector('[data-cg="suiv"]'), bPasser = fond.querySelector('[data-cg="passer"]');
    const ancienOverflow = document.body.style.overflow; document.body.style.overflow = "hidden";

    function montrer() {
      const e = etapes[i];
      contenu.innerHTML = (e.puce ? `<div class="cg-puce">${icone(e.icone)}${esc(e.puce)}</div>` : "") +
        `<h2 class="cg-titre" id="cg-titre">${esc(e.titre)}</h2><p class="cg-texte">${esc(e.texte)}</p>`;
      fond.querySelectorAll(".cg-points span").forEach((s, k) => s.classList.toggle("on", k === i));
      bPrec.hidden = i === 0;
      bPasser.hidden = !!e.estFin;
      bSuiv.textContent = e.estFin ? (e.bouton || "Terminer") : (i === 0 ? "Allons-y" : "Suivant");
      bSuiv.classList.toggle("cg-jaune", !!e.estFin);
      // Le Commis parle le temps de « dire » la bulle
      perso.classList.add("cg-parle"); clearTimeout(minuterie);
      minuterie = setTimeout(() => perso.classList.remove("cg-parle"), Math.min(4000, 600 + (e.texte || "").length * 22));
      if (i > 0) perso.classList.remove("cg-salue");
      bSuiv.focus();
    }
    function fermer(fini) {
      clearTimeout(minuterie);
      document.removeEventListener("keydown", clavier, true);
      fond.remove(); document.body.style.overflow = ancienOverflow;
      if (avant && avant.focus) try { avant.focus(); } catch (x) {}
      if (opts.onFermer) opts.onFermer(!!fini);
    }
    function clavier(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); fermer(false); }
      else if (ev.key === "ArrowRight" && i < etapes.length - 1) { i++; montrer(); }
      else if (ev.key === "ArrowLeft" && i > 0) { i--; montrer(); }
      else if (ev.key === "Tab") { // garder le focus dans la boîte
        const f = [...fond.querySelectorAll("button")].filter((b) => !b.hidden);
        if (!f.length) return;
        if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener("keydown", clavier, true);
    bPrec.onclick = () => { if (i > 0) { i--; montrer(); } };
    bPasser.onclick = () => fermer(false);
    bSuiv.onclick = () => {
      const e = etapes[i];
      if (e.estFin) { fermer(true); if (e.action) e.action(); return; }
      i++; montrer();
    };
    fond.addEventListener("click", (ev) => { if (ev.target === fond) fermer(false); });
    montrer();
    return { fermer };
  }

  // Rosalie toujours présente : son visage reste dans le coin; elle peut dire un mot dans une bulle.
  //   const r = CommisGuide.presence({ surFace: () => …, label: "Parler à Rosalie" });
  //   r.dire({ titre, texte, bouton, action, duree })   r.taire()
  let presenceActive = null;
  function presence(opts) {
    style();
    if (presenceActive) return presenceActive;
    const box = document.createElement("div");
    box.className = "cg-lanceur";
    box.innerHTML = `<div class="cg-dit" role="status" hidden></div>
      <button type="button" class="cg-mini" aria-label="${esc(opts.label || "Parler à Rosalie, votre commis")}">${AVATAR}</button>`;
    document.body.appendChild(box);
    const dit = box.querySelector(".cg-dit"), mini = box.querySelector(".cg-mini");
    let minuterie = null;
    mini.onclick = () => { taire(); if (opts.surFace) opts.surFace(); };
    function taire() { clearTimeout(minuterie); dit.hidden = true; dit.innerHTML = ""; mini.classList.remove("cg-parle"); }
    function dire(m) {
      clearTimeout(minuterie);
      dit.innerHTML = `<button type="button" class="cg-ferme" aria-label="Fermer">✕</button><b>${esc(m.titre || "")}</b>${esc(m.texte || "")}` +
        (m.bouton ? `<br><button type="button" class="cg-go">${esc(m.bouton)}</button>` : "");
      dit.hidden = false;
      mini.classList.add("cg-parle"); setTimeout(() => mini.classList.remove("cg-parle"), Math.min(3500, 600 + (m.texte || "").length * 22));
      dit.querySelector(".cg-ferme").onclick = () => { taire(); if (m.onFermer) m.onFermer(); };
      const go = dit.querySelector(".cg-go"); if (go) go.onclick = () => { taire(); if (m.action) m.action(); };
      if (m.duree) minuterie = setTimeout(taire, m.duree);
    }
    presenceActive = { dire, taire, element: box, cacher: (oui) => { box.hidden = !!oui; } };
    return presenceActive;
  }
  // Ancienne forme (site) : la face reste, la bulle propose la visite
  function lanceur(opts) {
    const r = presence({ surFace: opts.ouvrir, label: (opts.bouton || "Faire la visite") + " avec Rosalie, votre commis" });
    r.dire({ titre: opts.titre, texte: opts.texte, bouton: opts.bouton || "Faire la visite", action: opts.ouvrir, onFermer: opts.onFermer });
    return r;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // Les concepts du Commis, communs au site et à l'app
  const CONCEPTS = [
    { puce: "Onglet Produits", icone: "produits", titre: "Tout ce que vous achetez, une seule fois",
      texte: "Vos produits habituels ont chacun leur fiche : photo, marque, format et prix dans chaque épicerie. Une photo suffit pour en ajouter un. L'étoile ★ me dit lesquels surveiller." },
    { puce: "Onglet Lieu", icone: "lieu", titre: "Ce que vous avez, là où c'est rangé",
      texte: "Frigo, garde-manger, congélateur : je sais ce qui reste et où. À la Maison comme au Chalet. Ce qui va passer date monte en haut, en rouge." },
    { puce: "Onglet Liste épicerie", icone: "liste", titre: "Une liste pour toute la maison",
      texte: "La même liste sur chaque téléphone, à jour en direct. Quand un produit passe sous son minimum, je l'ajoute moi-même. À l'épicerie, on coche." },
    { puce: "Onglet Spéciaux", icone: "speciaux", titre: "Je lis les circulaires pour vous",
      texte: "Chaque jeudi matin, je parcours IGA, Metro, Maxi, Super C et Provigo. Je vous montre seulement les rabais sur vos produits ★." },
    { puce: "Facture et économies", icone: "facture", titre: "Le reçu en photo, et c'est rangé",
      texte: "De retour de l'épicerie, photographiez le reçu. Je range chaque article à sa place, je note les prix… et ce que vous avez économisé." },
    { puce: "Bilan du soir", icone: "soir", titre: "Trente secondes, à 21 h",
      texte: "Une seule question chaque soir : qu'avez-vous utilisé aujourd'hui? Un toucher par produit, et l'inventaire reste juste." },
  ];

  window.CommisGuide = { ouvrir, lanceur, presence, avatar: () => AVATAR, CONCEPTS };
})();
