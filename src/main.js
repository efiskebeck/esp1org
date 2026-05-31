import { db } from './firebase.js'
import {
  collection, query, orderBy,
  getDocs, addDoc, serverTimestamp
} from 'firebase/firestore'

// ─── State ────────────────────────────────────────────────
let allArticles = []
let activeCategory = 'alle'

// ─── Category config ──────────────────────────────────────
const CAT_CONFIG = {
  skyting:    { label: 'Skyting',    color: 'ci-gold',   tagClass: 'tg-gold',   accent: '#c9a84c40', layout: 'grid' },
  reisebrev:  { label: 'Reisebrev',  color: 'ci-blue',   tagClass: 'tg-blue',   accent: '#4a7ab540', layout: 'grid' },
  forsvaret:  { label: 'Forsvaret',  color: 'ci-green',  tagClass: 'tg-green',  accent: '#4a8a5a40', layout: 'list' },
  ledelse:    { label: 'Ledelse',    color: 'ci-purple', tagClass: 'tg-purple', accent: '#7a5ab540', layout: 'grid' },
  refleksjon: { label: 'Refleksjon', color: 'ci-orange', tagClass: 'tg-orange', accent: '#b5713a40', layout: 'grid' },
}

function getCatForArticle(article) {
  const cat   = (article.category || '').toLowerCase()
  const title = (article.title    || '').toLowerCase()
  const tags  = (article.tags     || '').toLowerCase()
  const all   = cat + ' ' + title + ' ' + tags

  if (['refleksjon','hitfactor','mentalt fokus','årskavalkade','kavalkade','årsoppsummering',
       'ny bok','moro på banen'].some(k => all.includes(k))) return 'refleksjon'
  if (['reisebrev','resebrev','nordisk','skepplanda','sno 2025','latin american','championship','open 2025',
       'vm #','nm i stavanger','norgesmesterskapet','europamesterskap','moose','fox'].some(k => all.includes(k))) return 'reisebrev'
  if (['militær','military','nato','hns','flo','nlogs','stab','fagartikkel','forsvaret','forsvar',
       'operasjon','totalforsvar','comprehensive','j4','vertsland'].some(k => all.includes(k))) return 'forsvaret'
  if (['ledelse','leadership','mentor'].some(k => all.includes(k))) return 'ledelse'
  return 'skyting'
}

// ─── Date formatting ──────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function stripHtml(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || ''
}

function excerpt(html, len = 120) {
  return stripHtml(html).slice(0, len).trim() + '…'
}

function firstImage(article) {
  if (article.heroImage) return article.heroImage
  if (!article.body) return null
  const match = article.body.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match ? match[1] : null
}

// ─── Target watermark SVG ─────────────────────────────────
const targetSvg = `<svg viewBox="0 0 80 80" fill="none" aria-hidden="true">
  <circle cx="40" cy="40" r="38" stroke="#c9a84c" stroke-width="0.8"/>
  <circle cx="40" cy="40" r="26" stroke="#c9a84c" stroke-width="0.8"/>
  <circle cx="40" cy="40" r="14" stroke="#c9a84c" stroke-width="0.8"/>
  <circle cx="40" cy="40" r="4" fill="#c9a84c"/>
  <line x1="40" y1="0" x2="40" y2="26" stroke="#c9a84c" stroke-width="0.8"/>
  <line x1="40" y1="54" x2="40" y2="80" stroke="#c9a84c" stroke-width="0.8"/>
  <line x1="0" y1="40" x2="26" y2="40" stroke="#c9a84c" stroke-width="0.8"/>
  <line x1="54" y1="40" x2="80" y2="40" stroke="#c9a84c" stroke-width="0.8"/>
</svg>`

// ─── Fetch all articles ────────────────────────────────────
async function fetchArticles() {
  const q = query(collection(db, 'articles'), orderBy('date', 'desc'))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(a => a.published === true)
}

// ─── Render sections ───────────────────────────────────────
function renderSections(articles, singleCat = null) {
  const main = document.getElementById('main')

  const groups = {}
  for (const key of Object.keys(CAT_CONFIG)) groups[key] = []
  for (const a of articles) {
    const cat = getCatForArticle(a)
    if (groups[cat]) groups[cat].push(a)
  }

  let html = ''
  for (const [key, cfg] of Object.entries(CAT_CONFIG)) {
    const items = groups[key]
    if (!items.length) continue
    // When showing a single category, show all items; otherwise preview
    const showAll = singleCat === key
    const preview = cfg.layout === 'grid' ? 3 : 6
    const displayed = showAll ? items : items.slice(0, preview)

    html += `<section class="cat-section" data-section="${key}">
      <div class="cat-header">
        <div class="cat-header-left">
          <div class="cat-icon-line ${cfg.color}"></div>
          <div class="cat-name">${cfg.label}</div>
          <div class="cat-count">${items.length} innlegg</div>
        </div>
        ${!showAll && items.length > preview
          ? `<div class="cat-see-all" data-cat="${key}">Se alle ${items.length} →</div>`
          : ''}
      </div>
      ${cfg.layout === 'grid' ? renderGrid(displayed, cfg) : renderList(displayed, cfg)}
    </section>`
  }

  main.innerHTML = html || '<p style="padding:3rem;color:#333;text-align:center">Ingen innlegg funnet.</p>'
}

// ─── Magazine-style grid ───────────────────────────────────
function renderGrid(items, cfg) {
  if (!items.length) return ''

  // First item: big card, rest: small
  const [main, ...rest] = items

  const mainImg = firstImage(main)
  const bigCard = `
    <div class="card-big" data-id="${main.id}">
      ${mainImg
        ? `<img class="card-big-img" src="${mainImg}" alt="${main.title}" loading="lazy">`
        : `<div class="card-big-placeholder">${targetSvg}</div>`}
      <div class="card-big-overlay"></div>
      <div class="corner-tl"></div>
      <div class="corner-br"></div>
      <div class="card-big-body">
        <div class="card-eyebrow">
          <span class="card-cat ${cfg.tagClass}">${main.category || cfg.label}</span>
          <span class="card-date">${fmtDate(main.date)}</span>
        </div>
        <div class="card-title">${main.title}</div>
        <div class="card-excerpt">${excerpt(main.body || '', 120)}</div>
        <div class="card-read">Les innlegget →</div>
      </div>
    </div>`

  const smallCards = rest.map(a => {
    const img = firstImage(a)
    return `
    <div class="card-small" data-id="${a.id}">
      ${img
        ? `<img class="card-small-img" src="${img}" alt="${a.title}" loading="lazy">`
        : `<div class="card-small-placeholder"></div>`}
      <div class="card-small-body">
        <div class="card-eyebrow">
          <span class="card-cat ${cfg.tagClass}">${a.category || cfg.label}</span>
          <span class="card-date">${fmtDate(a.date)}</span>
        </div>
        <div class="card-title-sm">${a.title}</div>
      </div>
    </div>`
  }).join('')

  return `<div class="magazine-grid">
    ${bigCard}
    <div class="card-stack">${smallCards}</div>
  </div>`
}

function renderList(items, cfg) {
  return `<div class="wide-list">${items.map((a, i) => `
    <div class="wl-item" data-id="${a.id}">
      <div class="wl-num">0${i+1}</div>
      <div class="wl-accent" style="background:${cfg.accent}"></div>
      <div class="wl-info">
        <div class="wl-title">${a.title}</div>
        <div class="wl-meta">${fmtDate(a.date)}${a.tags ? ' · ' + a.tags : ''}</div>
      </div>
      <div class="wl-cat">${a.category || cfg.label}</div>
    </div>`).join('')}</div>`
}

// ─── Om meg ────────────────────────────────────────────────
function renderAbout() {
  document.getElementById('main').innerHTML = `
    <section class="about-section">
      <div class="about-eyebrow">Om meg</div>
      <h1 class="about-name">Espen <em>Fiskebeck</em></h1>
      <p class="about-bio">
        Oberstløytnant i Forsvaret og sjef for Vertslandsstøtte ved NLOGS/FLO.
        Landslagssjef og utøver på Pistollandslaget i DSSN, med spesialisering i IPSC Classic Division.
        Instruktør, kursutvikler og engasjert i organisasjonsledelse i norsk pistolskyting.
        Masterstudent ved Stabsskolen med fokus på militær strategi og fellesoperasjoner.
      </p>
      <div class="about-roles">
        <div class="about-role">
          <div class="about-role-title">Sjef Vertslandsstøtte</div>
          <div class="about-role-sub">NLOGS · FLO · Forsvaret</div>
        </div>
        <div class="about-role">
          <div class="about-role-title">Sjef Pistollandslaget</div>
          <div class="about-role-sub">DSSN · IPSC Classic Division</div>
        </div>
        <div class="about-role">
          <div class="about-role-title">Masterstudent</div>
          <div class="about-role-sub">Stabsskolen · Militær strategi</div>
        </div>
        <div class="about-role">
          <div class="about-role-title">Instruktør & kursutvikler</div>
          <div class="about-role-sub">DSSN · RO · Godkjenningskurs</div>
        </div>
      </div>
    </section>`
}

// ─── Filter ────────────────────────────────────────────────
function filterCategory(cat) {
  activeCategory = cat
  document.querySelectorAll('.nav-cat, .mobile-menu button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat)
  })

  if (cat === 'om') { renderAbout(); return }

  if (cat === 'alle') {
    renderSections(allArticles, null)
  } else {
    // Show ALL articles in this category, hide others
    renderSections(allArticles, cat)
    document.querySelectorAll('.cat-section').forEach(s => {
      s.style.display = s.dataset.section === cat ? '' : 'none'
    })
  }
}

// ─── Modal ─────────────────────────────────────────────────
function openArticle(articleId) {
  const article = allArticles.find(a => a.id === articleId)
  if (!article) return

  const modal   = document.getElementById('modal')
  const content = document.getElementById('modalContent')

  const commentsHtml = (article.comments || []).map(c => `
    <div class="comment-item">
      <div class="comment-author">${c.name}</div>
      <div class="comment-date">${c.date || ''}</div>
      <div class="comment-body">${c.body}</div>
    </div>`).join('') || '<p style="font-size:12px;color:#333;padding:0.5rem 0">Ingen kommentarer ennå.</p>'

  // Build modal with newspaper style
  const panel = document.getElementById('modalPanel')
  panel.innerHTML = `
    <div class="modal-topbar">
      <div class="modal-topbar-logo">esp<em>1</em>.org</div>
      <div class="modal-topbar-cat">${article.category || 'Artikkel'}</div>
      <button class="modal-close" id="modalClose" aria-label="Lukk">✕</button>
    </div>
    <div class="modal-content" id="modalContent">
      <div class="modal-eyebrow">${article.category || 'Artikkel'}</div>
      <h2 class="modal-title" id="modalTitle">${article.title}</h2>
      <div class="modal-meta">${fmtDate(article.date)}</div>
      ${article.heroImage ? `<img class="modal-hero-img" src="${article.heroImage}" alt="${article.title}">` : ''}
      <div class="modal-body">${article.body || ''}</div>
      <div class="modal-divider"></div>
      <div class="comments-section">
        <div class="comments-title">Kommentarer</div>
        <div id="commentList">${commentsHtml}</div>
        <div class="comment-form">
          <input id="commentName" type="text" placeholder="Ditt navn" maxlength="80">
          <textarea id="commentBody" placeholder="Din kommentar…" maxlength="1000"></textarea>
          <button class="comment-submit" id="submitComment">Legg inn kommentar</button>
        </div>
      </div>
    </div>`
  // Re-attach close button
  document.getElementById('modalClose').addEventListener('click', closeModal)

  modal.classList.add('open')
  document.body.style.overflow = 'hidden'

  document.getElementById('submitComment').addEventListener('click', async () => {
    const name = document.getElementById('commentName').value.trim()
    const body = document.getElementById('commentBody').value.trim()
    if (!name || !body) return
    await addDoc(collection(db, 'articles', articleId, 'comments'), {
      name, body, date: new Date().toLocaleDateString('nb-NO'), createdAt: serverTimestamp()
    })
    document.getElementById('commentName').value = ''
    document.getElementById('commentBody').value = ''
    document.getElementById('commentList').innerHTML += `
      <div class="comment-item">
        <div class="comment-author">${name}</div>
        <div class="comment-date">I dag</div>
        <div class="comment-body">${body}</div>
      </div>`
  })
}

function closeModal() {
  document.getElementById('modal').classList.remove('open')
  document.body.style.overflow = ''
}

// ─── Events ────────────────────────────────────────────────
document.addEventListener('click', e => {
  const articleEl = e.target.closest('[data-id]')
  if (articleEl) { openArticle(articleEl.dataset.id); return }
  const navCat = e.target.closest('[data-cat]')
  if (navCat) { filterCategory(navCat.dataset.cat); return }
  if (e.target.matches('.cat-see-all')) { filterCategory(e.target.dataset.cat); return }
  if (e.target.matches('#modalClose') || e.target.matches('#modalBackdrop')) { closeModal(); return }
})

document.getElementById('mobileToggle').addEventListener('click', () => {
  document.getElementById('mobileMenu').classList.toggle('open')
})

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

// ─── Boot ──────────────────────────────────────────────────
async function init() {
  try {
    allArticles = await fetchArticles()
    renderSections(allArticles)
  } catch (err) {
    console.error('Firebase error:', err)
    document.getElementById('main').innerHTML =
      '<p style="padding:3rem;color:#444;text-align:center;font-size:12px">Kunne ikke laste innlegg.</p>'
  }
}

init()
