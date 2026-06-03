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
// ─── Cache helpers ─────────────────────────────────────────
const CACHE_KEY = 'esp1_articles_v1'
const CACHE_TTL = 5 * 60 * 1000  // 5 minutes

function cacheRead() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    // Deserialise Firestore Timestamps stored as { _seconds, _nanoseconds }
    return data.map(a => ({
      ...a,
      date: a.date?._seconds ? { toDate: () => new Date(a.date._seconds * 1000) } : a.date
    }))
  } catch { return null }
}

function cacheWrite(articles) {
  try {
    // Serialise Timestamp objects so they survive JSON round-trip
    const serialised = articles.map(a => ({
      ...a,
      date: a.date?.toDate
        ? { _seconds: Math.floor(a.date.toDate().getTime() / 1000) }
        : a.date
    }))
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: serialised }))
  } catch { /* storage full or private mode — ignore */ }
}

function cacheIsFresh() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return false
    return (Date.now() - JSON.parse(raw).ts) < CACHE_TTL
  } catch { return false }
}

async function fetchFromFirebase() {
  const q    = query(collection(db, 'articles'), orderBy('date', 'desc'))
  const snap = await getDocs(q)
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(a => a.published === true)
}

async function fetchArticles() {
  const cached = cacheRead()

  if (cached) {
    // Show cached data immediately — revalidate in background if stale
    if (!cacheIsFresh()) {
      fetchFromFirebase()
        .then(fresh => {
          cacheWrite(fresh)
          // Silently update if data changed (compare count + first id)
          if (
            fresh.length !== allArticles.length ||
            fresh[0]?.id !== allArticles[0]?.id
          ) {
            allArticles = fresh
            renderSections(allArticles)
          }
        })
        .catch(() => {/* network error — cached data stays */})
    }
    return cached
  }

  // No cache — must wait for Firebase (first visit or cleared storage)
  const fresh = await fetchFromFirebase()
  cacheWrite(fresh)
  return fresh
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

  // Single category — render full category page
  if (singleCat && groups[singleCat]) {
    main.innerHTML = renderCategoryPage(singleCat, CAT_CONFIG[singleCat], groups[singleCat])
    return
  }

  // All categories — preview mode
  let html = ''
  for (const [key, cfg] of Object.entries(CAT_CONFIG)) {
    const items = groups[key]
    if (!items.length) continue
    const preview = cfg.layout === 'grid' ? 3 : 6

    html += `<section class="cat-section" data-section="${key}">
      <div class="cat-header">
        <div class="cat-header-left">
          <div class="cat-icon-line ${cfg.color}"></div>
          <div class="cat-name">${cfg.label}</div>
          <div class="cat-count">${items.length} innlegg</div>
        </div>
        ${items.length > preview
          ? `<div class="cat-see-all" data-cat="${key}">Se alle ${items.length} →</div>`
          : ''}
      </div>
      ${cfg.layout === 'grid' ? renderGrid(items.slice(0, preview), cfg) : renderList(items.slice(0, preview), cfg)}
    </section>`
  }

  main.innerHTML = html || '<p style="padding:3rem;color:#333;text-align:center">Ingen innlegg funnet.</p>'
}

// ─── Full category page ────────────────────────────────────
function renderCategoryPage(key, cfg, items) {
  if (!items.length) return '<p style="padding:3rem;color:#333;text-align:center">Ingen innlegg.</p>'

  const featured = items.slice(0, 3)
  const archive  = items.slice(3)

  // Featured: 1 big + 2 portrait cards
  const [f1, f2, f3] = featured
  const f1img = firstImage(f1)
  const f2img = f2 ? firstImage(f2) : null
  const f3img = f3 ? firstImage(f3) : null

  const featuredHtml = `
    <div class="catpage-featured">
      <div class="catpage-big" data-id="${f1.id}">
        ${f1img
          ? `<img class="catpage-big-img" src="${f1img}" alt="${f1.title}" loading="lazy">`
          : `<div class="catpage-big-placeholder">${targetSvg}</div>`}
        <div class="catpage-big-overlay"></div>
        <div class="corner-tl"></div>
        <div class="corner-br"></div>
        <div class="catpage-big-body">
          <div class="card-eyebrow">
            <span class="card-cat ${cfg.tagClass}">${cfg.label}</span>
            <span class="card-date">${fmtDate(f1.date)}</span>
          </div>
          <div class="catpage-big-title">${f1.title}</div>
          <div class="catpage-big-excerpt">${excerpt(f1.body || '', 160)}</div>
          <div class="card-read">Les innlegget →</div>
        </div>
      </div>
      <div class="catpage-portraits">
        ${f2 ? `
        <div class="catpage-portrait" data-id="${f2.id}">
          ${f2img
            ? `<img class="catpage-portrait-img" src="${f2img}" alt="${f2.title}" loading="lazy">`
            : `<div class="catpage-portrait-placeholder"></div>`}
          <div class="catpage-portrait-body">
            <div class="card-eyebrow">
              <span class="card-cat ${cfg.tagClass}">${cfg.label}</span>
              <span class="card-date">${fmtDate(f2.date)}</span>
            </div>
            <div class="catpage-portrait-title">${f2.title}</div>
          </div>
        </div>` : ''}
        ${f3 ? `
        <div class="catpage-portrait" data-id="${f3.id}">
          ${f3img
            ? `<img class="catpage-portrait-img" src="${f3img}" alt="${f3.title}" loading="lazy">`
            : `<div class="catpage-portrait-placeholder"></div>`}
          <div class="catpage-portrait-body">
            <div class="card-eyebrow">
              <span class="card-cat ${cfg.tagClass}">${cfg.label}</span>
              <span class="card-date">${fmtDate(f3.date)}</span>
            </div>
            <div class="catpage-portrait-title">${f3.title}</div>
          </div>
        </div>` : ''}
      </div>
    </div>`

  // Archive list with thumbnails
  const archiveHtml = archive.length ? `
    <div class="catpage-archive">
      <div class="catpage-archive-header">
        <div class="catpage-archive-line"></div>
        <span class="catpage-archive-label">Arkiv — ${archive.length} innlegg</span>
        <div class="catpage-archive-line"></div>
      </div>
      <div class="catpage-archive-list">
        ${archive.map((a, i) => {
          const img = firstImage(a)
          return `
          <div class="catpage-archive-item" data-id="${a.id}">
            <div class="catpage-archive-num">${String(i + 4).padStart(2, '0')}</div>
            ${img
              ? `<img class="catpage-archive-thumb" src="${img}" alt="${a.title}" loading="lazy">`
              : `<div class="catpage-archive-thumb-empty"></div>`}
            <div class="catpage-archive-info">
              <div class="catpage-archive-title">${a.title}</div>
              <div class="catpage-archive-meta">${fmtDate(a.date)}</div>
            </div>
            <div class="catpage-archive-arrow">→</div>
          </div>`
        }).join('')}
      </div>
    </div>` : ''

  return `
    <section class="catpage" data-section="${key}">
      <div class="catpage-header">
        <div class="catpage-header-left">
          <div class="cat-icon-line ${cfg.color}"></div>
          <div class="catpage-headline">${cfg.label}</div>
          <div class="cat-count">${items.length} innlegg</div>
        </div>
        <button class="catpage-back" data-cat="alle">← Alle kategorier</button>
      </div>
      ${featuredHtml}
      ${archiveHtml}
    </section>`
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
  document.querySelectorAll('.nav-cat, .mobile-menu button, .mob-nav-btn').forEach(btn => {
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

  // Update URL so the article is shareable/bookmarkable
  history.pushState({ articleId }, '', `?id=${articleId}`)

  // Build modal with newspaper style
  const panel = document.getElementById('modalPanel')
  panel.innerHTML = `
    <div class="modal-topbar">
      <div class="modal-topbar-logo">esp<em>1</em>.org</div>
      <div class="modal-topbar-cat">${article.category || 'Artikkel'}</div>
      <div class="modal-topbar-actions">
        <button class="modal-share-btn" id="shareBtn" aria-label="Del artikkel" title="Del artikkel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span class="share-feedback" id="shareFeedback"></span>
        </button>
        <button class="modal-close" id="modalClose" aria-label="Lukk">✕</button>
      </div>
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

  // Share button
  document.getElementById('shareBtn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?id=${articleId}`
    const feedback = document.getElementById('shareFeedback')

    // Use native share sheet on mobile if available
    if (navigator.share) {
      try {
        await navigator.share({ title: article.title, url })
        return
      } catch { /* user cancelled — fall through to clipboard */ }
    }

    // Desktop: copy to clipboard
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity  = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }

    feedback.textContent = 'Kopiert!'
    feedback.classList.add('visible')
    setTimeout(() => feedback.classList.remove('visible'), 2000)
  })

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
  history.pushState(null, '', location.pathname)
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
  const hasCached = !!cacheRead()

  // Show skeleton only if no cache (first visit)
  if (!hasCached) {
    document.getElementById('main').innerHTML = `
      <div class="skeleton-wrap">
        ${[1,2,3].map(() => `
          <div class="skeleton-section">
            <div class="skeleton-header">
              <div class="skeleton-line sw-40"></div>
              <div class="skeleton-line sw-16"></div>
            </div>
            <div class="skeleton-grid">
              <div class="skeleton-card-big"></div>
              <div class="skeleton-stack">
                <div class="skeleton-card-sm"></div>
                <div class="skeleton-card-sm"></div>
              </div>
            </div>
          </div>`).join('')}
      </div>`
  }

  try {
    allArticles = await fetchArticles()
    renderSections(allArticles)

    // Open article if URL contains ?id=
    const urlId = new URLSearchParams(location.search).get('id')
    if (urlId) openArticle(urlId)
  } catch (err) {
    console.error('Firebase error:', err)
    // If cache exists, try to use it even on error
    const fallback = cacheRead()
    if (fallback) {
      allArticles = fallback
      renderSections(allArticles)
    } else {
      document.getElementById('main').innerHTML =
        '<p style="padding:3rem;color:#444;text-align:center;font-size:12px">Kunne ikke laste innlegg.</p>'
    }
  }
}

init()
