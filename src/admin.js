import { auth, db, storage } from './firebase.js'
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'firebase/auth'
import {
  collection, query, orderBy, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'
import {
  ref, uploadBytes, getDownloadURL
} from 'firebase/storage'

// ─── Auth ──────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('loginScreen').style.display = 'none'
    document.getElementById('adminPanel').style.display = 'block'
    document.getElementById('adminEmail').textContent = user.email
    loadArticles()
  } else {
    document.getElementById('loginScreen').style.display = 'flex'
    document.getElementById('adminPanel').style.display = 'none'
  }
})

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault()
  const email    = document.getElementById('loginEmail').value
  const password = document.getElementById('loginPassword').value
  const errEl    = document.getElementById('loginError')
  errEl.textContent = ''
  try {
    await signInWithEmailAndPassword(auth, email, password)
  } catch {
    errEl.textContent = 'Feil e-post eller passord.'
  }
})

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth))

// ─── Tabs ──────────────────────────────────────────────────
let allAdminArticles = []

document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    const tab = btn.dataset.tab
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none')
    document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).style.display = 'block'
    if (tab === 'new') resetEditor()
  })
})

// ─── Load articles ─────────────────────────────────────────
async function loadArticles() {
  const q = query(collection(db, 'articles'), orderBy('date', 'desc'))
  const snap = await getDocs(q)
  allAdminArticles = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  renderAdminList(allAdminArticles)
}

function renderAdminList(articles) {
  const list = document.getElementById('articleList')
  if (!articles.length) {
    list.innerHTML = '<p style="padding:2rem;color:#333;font-size:13px">Ingen artikler ennå.</p>'
    return
  }
  list.innerHTML = articles.map(a => `
    <div class="ali-item" data-id="${a.id}">
      <div class="ali-dot ${a.published ? 'published' : 'draft'}"></div>
      <div class="ali-info">
        <div class="ali-title">${a.title}</div>
        <div class="ali-meta">${fmtDate(a.date)} · ${a.published ? 'Publisert' : 'Kladd'}</div>
      </div>
      <div class="ali-cat">${a.category || '—'}</div>
      <div class="ali-edit">Rediger</div>
    </div>`).join('')
}

// Search + filter
document.getElementById('searchInput').addEventListener('input', filterList)
document.getElementById('filterCat').addEventListener('change', filterList)

function filterList() {
  const q   = document.getElementById('searchInput').value.toLowerCase()
  const cat = document.getElementById('filterCat').value
  renderAdminList(allAdminArticles.filter(a =>
    (!q   || a.title.toLowerCase().includes(q)) &&
    (!cat || (a.category || '').toLowerCase().includes(cat))
  ))
}

// Click to edit
document.getElementById('articleList').addEventListener('click', e => {
  const item = e.target.closest('.ali-item')
  if (!item) return
  const article = allAdminArticles.find(a => a.id === item.dataset.id)
  if (article) openEditor(article)
})

// ─── Editor ────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
}

function toDateInput(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toISOString().split('T')[0]
}

function resetEditor() {
  document.getElementById('editId').value = ''
  document.getElementById('editTitle').value = ''
  document.getElementById('editCategory').value = 'skyting'
  document.getElementById('editTags').value = ''
  document.getElementById('editDate').value = new Date().toISOString().split('T')[0]
  document.getElementById('editorBody').innerHTML = ''
  document.getElementById('editPublished').checked = false
  document.getElementById('heroImagePreview').innerHTML = ''
  document.getElementById('heroImageUrl').value = ''
  document.getElementById('galleryPreview').innerHTML = ''
  document.getElementById('deleteBtn').style.display = 'none'
  document.getElementById('saveStatus').textContent = ''
}

function openEditor(article) {
  // Switch to new/edit tab
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'))
  document.querySelector('[data-tab="new"]').classList.add('active')
  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none')
  document.getElementById('tabNew').style.display = 'block'

  document.getElementById('editId').value = article.id
  document.getElementById('editTitle').value = article.title || ''
  document.getElementById('editCategory').value = article.category || 'skyting'
  document.getElementById('editTags').value = article.tags || ''
  document.getElementById('editDate').value = toDateInput(article.date)
  document.getElementById('editorBody').innerHTML = article.body || ''
  document.getElementById('editPublished').checked = !!article.published
  document.getElementById('deleteBtn').style.display = 'block'
  document.getElementById('saveStatus').textContent = ''

  if (article.heroImage) {
    document.getElementById('heroImagePreview').innerHTML =
      `<img src="${article.heroImage}" alt="Hero">`
    document.getElementById('heroImageUrl').value = article.heroImage
  } else {
    document.getElementById('heroImagePreview').innerHTML = ''
    document.getElementById('heroImageUrl').value = ''
  }
}

// ─── Toolbar ───────────────────────────────────────────────
document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd
    const body = document.getElementById('editorBody')
    body.focus()
    switch (cmd) {
      case 'bold':        document.execCommand('bold'); break
      case 'italic':      document.execCommand('italic'); break
      case 'h2': {
        const sel = window.getSelection()
        const text = sel.toString() || 'Overskrift'
        document.execCommand('insertHTML', false, `<h2>${text}</h2><p><br></p>`)
        break
      }
      case 'h3': {
        const sel = window.getSelection()
        const text = sel.toString() || 'Overskrift'
        document.execCommand('insertHTML', false, `<h3>${text}</h3><p><br></p>`)
        break
      }
      case 'quote': {
        const sel = window.getSelection()
        const text = sel.toString() || 'Sitat'
        document.execCommand('insertHTML', false, `<blockquote>${text}</blockquote><p><br></p>`)
        break
      }
      case 'link': {
        const url = prompt('Lenke-URL:')
        if (url) document.execCommand('createLink', false, url)
        break
      }
      case 'insertImage': {
        const url = prompt('Bilde-URL:')
        if (url) document.execCommand('insertHTML', false, `<img src="${url}" alt="">`)
        break
      }
    }
  })
})

// Preview toggle
let previewing = false
document.getElementById('previewToggle').addEventListener('click', () => {
  previewing = !previewing
  document.getElementById('editorBody').style.display   = previewing ? 'none'  : 'block'
  document.getElementById('previewBody').style.display  = previewing ? 'block' : 'none'
  document.getElementById('previewToggle').textContent  = previewing ? 'Rediger' : 'Forhåndsvisning'
  if (previewing) {
    document.getElementById('previewBody').innerHTML =
      document.getElementById('editorBody').innerHTML
  }
})

// ─── Image upload to Firebase Storage ─────────────────────
async function uploadImage(file, path) {
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file)
  return getDownloadURL(storageRef)
}

// Hero image file picker
document.getElementById('heroImageFile').addEventListener('change', async e => {
  const file = e.target.files[0]
  if (!file) return
  const status = document.getElementById('saveStatus')
  status.textContent = 'Laster opp bilde…'
  status.className = 'save-status'
  try {
    const url = await uploadImage(file, `heroes/${Date.now()}_${file.name}`)
    document.getElementById('heroImageUrl').value = url
    document.getElementById('heroImagePreview').innerHTML = `<img src="${url}" alt="Hero">`
    status.textContent = 'Bilde lastet opp!'
    status.className = 'save-status ok'
  } catch {
    status.textContent = 'Feil ved opplasting.'
    status.className = 'save-status err'
  }
})

// Gallery files
document.getElementById('galleryFiles').addEventListener('change', async e => {
  const files = Array.from(e.target.files)
  const preview = document.getElementById('galleryPreview')
  const status = document.getElementById('saveStatus')
  status.textContent = `Laster opp ${files.length} bilder…`
  const urls = []
  for (const file of files) {
    try {
      const url = await uploadImage(file, `gallery/${Date.now()}_${file.name}`)
      urls.push(url)
      preview.innerHTML += `<img src="${url}" alt="">`
    } catch { /* skip */ }
  }
  status.textContent = `${urls.length} bilder lastet opp!`
  status.className = 'save-status ok'
})

// ─── Save ──────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  const status = document.getElementById('saveStatus')
  const id     = document.getElementById('editId').value

  const dateVal = document.getElementById('editDate').value
  const data = {
    title:     document.getElementById('editTitle').value.trim(),
    category:  document.getElementById('editCategory').value,
    tags:      document.getElementById('editTags').value.trim(),
    body:      document.getElementById('editorBody').innerHTML,
    heroImage: document.getElementById('heroImageUrl').value.trim() || null,
    published: document.getElementById('editPublished').checked,
    date:      dateVal ? new Date(dateVal) : new Date(),
    updatedAt: serverTimestamp(),
  }

  if (!data.title) { status.textContent = 'Tittel er påkrevd.'; status.className = 'save-status err'; return }

  status.textContent = 'Lagrer…'
  status.className = 'save-status'

  try {
    if (id) {
      await updateDoc(doc(db, 'articles', id), data)
    } else {
      const ref = await addDoc(collection(db, 'articles'), { ...data, createdAt: serverTimestamp() })
      document.getElementById('editId').value = ref.id
      document.getElementById('deleteBtn').style.display = 'block'
    }
    status.textContent = '✓ Lagret!'
    status.className = 'save-status ok'
    await loadArticles()
  } catch (err) {
    console.error(err)
    status.textContent = 'Feil ved lagring.'
    status.className = 'save-status err'
  }
})

// ─── Delete ────────────────────────────────────────────────
document.getElementById('deleteBtn').addEventListener('click', async () => {
  const id = document.getElementById('editId').value
  if (!id) return
  if (!confirm('Sikker på at du vil slette denne artikkelen?')) return
  try {
    await deleteDoc(doc(db, 'articles', id))
    await loadArticles()
    resetEditor()
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'))
    document.querySelector('[data-tab="articles"]').classList.add('active')
    document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none')
    document.getElementById('tabArticles').style.display = 'block'
  } catch (err) {
    console.error(err)
  }
})
