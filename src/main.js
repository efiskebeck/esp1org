import { db } from './firebase.js'
import {
  collection, query, orderBy, limit, where,
  getDocs, addDoc, serverTimestamp
} from 'firebase/firestore'

// ─── State ────────────────────────────────────────────────
let allArticles = []
let activeCategory = 'alle'

// ─── Category config ──────────────────────────────────────
const CAT_CONFIG = {
  skyting:  { label: 'Skyting & IPSC',       color: 'ci-gold',   tagClass: 'tg-gold',   accent: '#c9a84c40', layout: 'grid' },
  militær:  { label: 'Militær & Faglig',     color: 'ci-blue',   tagClass: 'tg-blue',   accent: '#4a7ab540', layout: 'list' },
  ledelse:  { label: 'Ledelse & Refleksjon', color: 'ci-purple', tagClass: 'tg-purple',  accent: '#7a5ab540', layout: 'grid' },
  personlig:{ label: 'Personlig',            color: 'ci-green',  tagClass: 'tg-green',  accent: '#4a8a5a40', layout: 'grid' },
}

function getCatForArticle(article) {
  const cat = (article.category || '').toLowerCase()
  if (['skyting','ipsc','nm','em','vm','match','reisebrev','kurs'].some(k => cat.includes(k))) return 'skyting'
  if (['militær','military','nato','hns','flo','nlogs','stab','fagartikkel'].some(k => cat.includes(k))) return 'militær'
  if (['ledelse','leadership','refleksjon','mentor'].some(k => cat.includes(k))) return 'ledelse'
  return 'personlig'
}

// ─── Date formatting ──────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ─── Strip HTML to plain text ─────────────────────────────
function stripHtml(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.textContent || ''
}

function excerpt(html, len = 120) {
  return stripHtml(html).slice(0, len).trim() + '…'
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
  const q = query(
    collection(db, 'articles'),
    where('published', '==', true),
    orderBy('date', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ─── Render featured strip (top 5) ────────────────────────
function renderFeatured(articles) {
  const top = articles.slice(0, 5)
  if (!top.length) { document.getElementById('featuredStrip').innerHTML = ''; return }

  const [main, ...sides] = top
  const mainCat = getCatForArticle(main)
  const cfg = CAT_CONFIG[mainCat] || CAT_CONFIG.personlig

  const sideHtml = sides.map((a, i) => {
    const c = CAT_CONFIG[getCatForArticle(a)] || CAT_CONFIG.personlig
    return `<div class="fs-side-item" data-id="${a.id}" style="background:linear-gradient(135deg,#09090e,#070707)">
      <div class="fsi-num">0${i+2}</div>
      <div class="fsi-cat" style="color:${c.accent}">${a.category || 'Artikkel'}</div>
      <div class="fsi-title">${a.title}</div>
      <div class="fsi-meta">${fmtDate(a.date)}</div>
    </div>`
  })

  // Split sides into two columns
  const col1 = sideHtml.slice(0, 2).join('')
  const col2 = sideHtml.slice(2, 4).join('')

  document.getElementById('featuredStrip').innerHTML = `
    <div class="fs-main" data-id="${main.id}">
      <div class="fs-watermark">${targetSvg}</div>
      <div class="fs-num">01</div>
      <div class="corner-tl"></div>
      <div class="corner-br"></div>
      <div class="fs-eyebrow">Siste innlegg · ${main.category || 'Artikkel'}</div>
      <div class="fs-title">${main.title}</div>
      <div class="fs-body">${excerpt(main.body || '', 160)}</div>
      <div class="fs-read">Les innlegget →</div>
    </div>
    <div class="fs-side">${col1}</div>
    <div class="fs-side">${col2}</div>
  `
}

// ─── Render category sections ──────────────────────────────
function renderSections(articles) {
  const main = document.getElementById('main')

  // Group by resolved category
  const groups = {}
  for (const [key] of Object.entries(CAT_CONFIG)) groups[key] = []
  for (const a of articles) {
    const cat = getCatForArticle(a)
    if (groups[cat]) groups[cat].push(a)
  }

  let html = ''
  for (const [key, cfg] of Object.entries(CAT_CONFIG)) {
    const items = groups[key]
    if (!items.length) continue

    html += `<section class="cat-section" data-section="${key}">
      <div class="cat-header">
        <div class="cat-header-left">
          <div class="cat-icon-line ${cfg.color}"></div>
          <div class="cat-name">${cfg.label}</div>
          <div class="cat-count">${items.length} innlegg</div>
        </div>
        <div class="cat-see-all" data-cat="${key}">Se alle →</div>
      </div>
      ${cfg.layout === 'grid' ? renderGrid(items.slice(0, 3), cfg) : renderList(items.slice(0, 6), cfg)}
    </section>`
  }

  main.innerHTML = html || '<p style="padding:3rem;color:#333;text-align:center">Ingen innlegg funnet.</p>'
}

function renderGrid(items, cfg) {
  return `<div class="cat-grid">${items.map((a, i) => `
    <div class="cg-item" data-id="${a.id}">
      ${a.heroImage ? `<img class="cg-item-img" src="${a.heroImage}" alt="${a.title}" loading="lazy">` : ''}
      <div class="cg-num">0${i+1}</div>
      <div class="cgi-eyebrow">
        <span class="cgi-tag ${cfg.tagClass}">${a.category || 'Artikkel'}</span>
        <span class="cgi-date">${fmtDate(a.date)}</span>
      </div>
      <div class="cgi-title">${a.title}</div>
      <div class="cgi-excerpt">${excerpt(a.body || '', 100)}</div>
    </div>`).join('')}</div>`
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
      <div class="wl-cat">${a.category || 'Artikkel'}</div>
    </div>`).join('')}</div>`
}

// ─── Render "Om meg" page ──────────────────────────────────
function renderAbout() {
  document.getElementById('featuredStrip').innerHTML = ''
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

// ─── Filter by category ────────────────────────────────────
function filterCategory(cat) {
  activeCategory = cat

  // Update nav
  document.querySelectorAll('.nav-cat, .mobile-menu button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat)
  })

  if (cat === 'om') { renderAbout(); return }

  const filtered = cat === 'alle'
    ? allArticles
    : allArticles.filter(a => getCatForArticle(a) === cat)

  renderFeatured(filtered)
  renderSections(cat === 'alle' ? allArticles : filtered)

  // If filtering, only show that section
  if (cat !== 'alle') {
    document.querySelectorAll('.cat-section').forEach(s => {
      s.style.display = s.dataset.section === cat ? '' : 'none'
    })
  }
}

// ─── Open article modal ────────────────────────────────────
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
    </div>`).join('') || '<p style="font-size:12px;color:#333;padding:0.5rem 0">Ingen kommentarer ennå. Vær den første!</p>'

  content.innerHTML = `
    <div class="modal-eyebrow">${article.category || 'Artikkel'}</div>
    <h2 class="modal-title" id="modalTitle">${article.title}</h2>
    <div class="modal-meta">${fmtDate(article.date)}</div>
    ${article.heroImage ? `<img class="modal-hero-img" src="${article.heroImage}" alt="${article.title}">` : ''}
    <div class="modal-body">${article.body || ''}</div>
    <div class="comments-section">
      <div class="comments-title">Kommentarer</div>
      <div id="commentList">${commentsHtml}</div>
      <div class="comment-form">
        <input id="commentName" type="text" placeholder="Ditt navn" maxlength="80">
        <textarea id="commentBody" placeholder="Din kommentar…" maxlength="1000"></textarea>
        <button class="comment-submit" id="submitComment">Legg inn kommentar</button>
      </div>
    </div>`

  modal.classList.add('open')
  document.body.style.overflow = 'hidden'

  // Submit comment
  document.getElementById('submitComment').addEventListener('click', async () => {
    const name = document.getElementById('commentName').value.trim()
    const body = document.getElementById('commentBody').value.trim()
    if (!name || !body) return

    await addDoc(collection(db, 'articles', articleId, 'comments'), {
      name, body, date: new Date().toLocaleDateString('nb-NO'), createdAt: serverTimestamp()
    })

    document.getElementById('commentName').value = ''
    document.getElementById('commentBody').value = ''

    const list = document.getElementById('commentList')
    list.innerHTML += `<div class="comment-item">
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

// ─── Event delegation ──────────────────────────────────────
document.addEventListener('click', e => {
  // Article click
  const articleEl = e.target.closest('[data-id]')
  if (articleEl) { openArticle(articleEl.dataset.id); return }

  // Nav category
  const navCat = e.target.closest('[data-cat]')
  if (navCat) { filterCategory(navCat.dataset.cat); return }

  // See all
  if (e.target.matches('.cat-see-all')) { filterCategory(e.target.dataset.cat); return }

  // Modal close
  if (e.target.matches('#modalClose') || e.target.matches('#modalBackdrop')) { closeModal(); return }
})

// Mobile toggle
document.getElementById('mobileToggle').addEventListener('click', () => {
  document.getElementById('mobileMenu').classList.toggle('open')
})

// Keyboard close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal()
})

// ─── Boot ──────────────────────────────────────────────────
async function init() {
  try {
    allArticles = await fetchArticles()
    renderFeatured(allArticles)
    renderSections(allArticles)
  } catch (err) {
    console.error('Firebase error:', err)
    document.getElementById('main').innerHTML =
      '<p style="padding:3rem;color:#444;text-align:center;font-size:12px">Kunne ikke laste innlegg. Sjekk Firebase-konfigurasjon.</p>'
  }
}

init()
