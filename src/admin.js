import { auth, db, storage } from './firebase.js'
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'firebase/auth'
import {
  collection, query, orderBy, getDocs,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'firebase/firestore'
import {
  ref, uploadBytesResumable, getDownloadURL
} from 'firebase/storage'

// ─── State ─────────────────────────────────────────────────
let galleryItems  = []   // [{ url, alt, position }]
let heroPosition  = 'center center'
let galleryLayout = 'grid'
let cropperInst   = null
let cropTarget    = null  // 'hero' or gallery index
let altTarget     = null  // gallery index
let sortableInst  = null

// ─── Auth ──────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('loginScreen').style.display  = 'none'
    document.getElementById('adminPanel').style.display   = 'block'
    document.getElementById('adminEmail').textContent     = user.email
    loadArticles()
  } else {
    document.getElementById('loginScreen').style.display  = 'flex'
    document.getElementById('adminPanel').style.display   = 'none'
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
  const q    = query(collection(db, 'articles'), orderBy('date', 'desc'))
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
  document.getElementById('editId').value       = ''
  document.getElementById('editTitle').value    = ''
  document.getElementById('editCategory').value = 'skyting'
  document.getElementById('editTags').value     = ''
  document.getElementById('editDate').value     = new Date().toISOString().split('T')[0]
  document.getElementById('editorBody').innerHTML = ''
  document.getElementById('editPublished').checked = false
  document.getElementById('heroImagePreview').innerHTML = ''
  document.getElementById('heroImageUrl').value = ''
  document.getElementById('heroImageUrl').style.display = 'none'
  document.getElementById('heroPositionWrap').style.display = 'none'
  document.getElementById('galleryPreview').innerHTML = ''
  document.getElementById('galleryHint').style.display = 'none'
  document.getElementById('galleryLayoutSelector').style.display = 'none'
  document.getElementById('deleteBtn').style.display = 'none'
  document.getElementById('saveStatus').textContent = ''
  galleryItems  = []
  heroPosition  = 'center center'
  galleryLayout = 'grid'
  setHeroPositionBtn('center center')
  initSortable()
}

function openEditor(article) {
  document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'))
  document.querySelector('[data-tab="new"]').classList.add('active')
  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none')
  document.getElementById('tabNew').style.display = 'block'

  document.getElementById('editId').value       = article.id
  document.getElementById('editTitle').value    = article.title    || ''
  document.getElementById('editCategory').value = article.category || 'skyting'
  document.getElementById('editTags').value     = article.tags     || ''
  document.getElementById('editDate').value     = toDateInput(article.date)
  document.getElementById('editorBody').innerHTML = article.body   || ''
  document.getElementById('editPublished').checked = !!article.published
  document.getElementById('deleteBtn').style.display = 'block'
  document.getElementById('saveStatus').textContent  = ''

  heroPosition  = article.heroPosition  || 'center center'
  galleryLayout = article.galleryLayout || 'grid'

  if (article.heroImage) {
    document.getElementById('heroImageUrl').value = article.heroImage
    renderHeroPreview(article.heroImage)
  } else {
    document.getElementById('heroImagePreview').innerHTML = ''
    document.getElementById('heroImageUrl').value         = ''
    document.getElementById('heroPositionWrap').style.display = 'none'
  }
  setHeroPositionBtn(heroPosition)

  galleryItems = Array.isArray(article.gallery) ? [...article.gallery] : []
  setTimeout(attachAllEditorImages, 0)
  renderGalleryPreview()
  initSortable()
}

// ─── Toolbar ───────────────────────────────────────────────
document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd  = btn.dataset.cmd
    const body = document.getElementById('editorBody')
    body.focus()
    switch (cmd) {
      case 'bold':   document.execCommand('bold');   break
      case 'italic': document.execCommand('italic'); break
      case 'h2': {
        const text = window.getSelection().toString() || 'Overskrift'
        document.execCommand('insertHTML', false, `<h2>${text}</h2><p><br></p>`)
        break
      }
      case 'h3': {
        const text = window.getSelection().toString() || 'Overskrift'
        document.execCommand('insertHTML', false, `<h3>${text}</h3><p><br></p>`)
        break
      }
      case 'quote': {
        const text = window.getSelection().toString() || 'Sitat'
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
    document.getElementById('previewBody').innerHTML = document.getElementById('editorBody').innerHTML
  }
})

// ─── Upload helper with progress ───────────────────────────
function uploadImageWithProgress(file, path, onProgress) {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path)
    const task       = uploadBytesResumable(storageRef, file)
    task.on('state_changed',
      snap => onProgress && onProgress(snap.bytesTransferred / snap.totalBytes),
      reject,
      async () => resolve(await getDownloadURL(task.snapshot.ref))
    )
  })
}

// ─── Hero: drop zone ───────────────────────────────────────
const heroDropZone = document.getElementById('heroDropZone')

heroDropZone.addEventListener('dragover',  e => { e.preventDefault(); heroDropZone.classList.add('drag-over') })
heroDropZone.addEventListener('dragleave', () => heroDropZone.classList.remove('drag-over'))
heroDropZone.addEventListener('drop', e => {
  e.preventDefault()
  heroDropZone.classList.remove('drag-over')
  const file = e.dataTransfer.files[0]
  if (file && file.type.startsWith('image/')) handleHeroFile(file)
})

// Paste anywhere on the page → hero image
document.addEventListener('paste', e => {
  const items = Array.from(e.clipboardData?.items || [])
  const imgItem = items.find(i => i.type.startsWith('image/'))
  if (!imgItem) return
  const file = imgItem.getAsFile()
  if (file) {
    e.preventDefault()
    handleHeroFile(file)
  }
})

// File picker
document.getElementById('heroImageFile').addEventListener('change', e => {
  const file = e.target.files[0]
  if (file) handleHeroFile(file)
})

// Camera
document.getElementById('heroImageCamera').addEventListener('change', e => {
  const file = e.target.files[0]
  if (file) handleHeroFile(file)
})

// URL button toggle
document.getElementById('heroUrlBtn').addEventListener('click', () => {
  const urlInput = document.getElementById('heroImageUrl')
  const showing  = urlInput.style.display !== 'none'
  urlInput.style.display = showing ? 'none' : 'block'
  if (!showing) urlInput.focus()
})

// URL input confirm on Enter
document.getElementById('heroImageUrl').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const url = e.target.value.trim()
    if (url) renderHeroPreview(url)
    document.getElementById('heroImageUrl').style.display = 'none'
  }
})

async function handleHeroFile(file) {
  const prog     = document.getElementById('heroProgress')
  const progBar  = document.getElementById('heroProgressBar')
  const progText = document.getElementById('heroProgressText')
  prog.style.display = 'flex'
  setStatus('Laster opp hero-bilde…')

  try {
    const url = await uploadImageWithProgress(
      file,
      `heroes/${Date.now()}_${file.name}`,
      p => {
        const pct = Math.round(p * 100)
        progBar.style.width = pct + '%'
        progText.textContent = pct + '%'
      }
    )
    document.getElementById('heroImageUrl').value = url
    renderHeroPreview(url)
    setStatus('Hero-bilde lastet opp!', 'ok')
  } catch {
    setStatus('Feil ved opplasting.', 'err')
  } finally {
    prog.style.display = 'none'
  }
}

function renderHeroPreview(url) {
  const preview = document.getElementById('heroImagePreview')
  preview.innerHTML = `
    <div class="hero-preview-wrap" style="--pos:${heroPosition}">
      <img src="${url}" alt="Hero" class="hero-preview-img">
      <div class="hero-preview-label">Forhåndsvisning · posisjon: <span id="heroPosLabel">${heroPosition}</span></div>
    </div>`
  document.getElementById('heroPositionWrap').style.display = 'block'
}

// ─── Hero position picker ──────────────────────────────────
document.getElementById('heroPositionGrid').addEventListener('click', e => {
  const btn = e.target.closest('.pos-btn')
  if (!btn) return
  heroPosition = btn.dataset.pos
  setHeroPositionBtn(heroPosition)
  const wrap = document.querySelector('.hero-preview-wrap')
  if (wrap) {
    wrap.style.setProperty('--pos', heroPosition)
    const lbl = document.getElementById('heroPosLabel')
    if (lbl) lbl.textContent = heroPosition
  }
})

function setHeroPositionBtn(pos) {
  document.querySelectorAll('.pos-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.pos === pos)
  })
}

// ─── Crop (hero) ───────────────────────────────────────────
document.getElementById('heroCropBtn').addEventListener('click', () => {
  const url = document.getElementById('heroImageUrl').value
  if (!url) return
  cropTarget = 'hero'
  openCropModal(url)
})

function openCropModal(src) {
  const modal = document.getElementById('cropModal')
  const img   = document.getElementById('cropImage')
  modal.style.display = 'flex'
  img.src = src

  if (cropperInst) { cropperInst.destroy(); cropperInst = null }

  img.onload = () => {
    const aspectVal = document.getElementById('cropAspect').value
    cropperInst = new Cropper(img, {
      aspectRatio: aspectVal === 'free' ? NaN : eval(aspectVal),
      viewMode:    2,
      autoCropArea: 1,
    })
  }
}

document.getElementById('cropAspect').addEventListener('change', e => {
  if (!cropperInst) return
  const val = e.target.value
  cropperInst.setAspectRatio(val === 'free' ? NaN : eval(val))
})

document.getElementById('cropRotateLeft').addEventListener('click',  () => cropperInst?.rotate(-90))
document.getElementById('cropRotateRight').addEventListener('click', () => cropperInst?.rotate(90))
document.getElementById('cropFlipH').addEventListener('click', () => {
  if (!cropperInst) return
  const d = cropperInst.getData()
  cropperInst.scaleX(d.scaleX === -1 ? 1 : -1)
})

document.getElementById('cropQuality').addEventListener('input', e => {
  document.getElementById('cropQualityVal').textContent = e.target.value + '%'
})

document.getElementById('cropCancel').addEventListener('click', closeCropModal)

document.getElementById('cropApply').addEventListener('click', async () => {
  if (!cropperInst) return
  const quality = parseInt(document.getElementById('cropQuality').value) / 100
  const canvas  = cropperInst.getCroppedCanvas({ maxWidth: 2400, maxHeight: 2400 })

  setStatus('Laster opp beskåret bilde…')
  closeCropModal()

  canvas.toBlob(async blob => {
    const file = new File([blob], `crop_${Date.now()}.jpg`, { type: 'image/jpeg' })
    try {
      const url = await uploadImageWithProgress(file, `heroes/${Date.now()}_crop.jpg`, null)
      if (cropTarget === 'hero') {
        document.getElementById('heroImageUrl').value = url
        renderHeroPreview(url)
      } else if (typeof cropTarget === 'number') {
        galleryItems[cropTarget].url = url
        renderGalleryPreview()
      }
      setStatus('Bilde lastet opp!', 'ok')
    } catch {
      setStatus('Feil ved opplasting.', 'err')
    }
  }, 'image/jpeg', quality)
})

function closeCropModal() {
  document.getElementById('cropModal').style.display = 'none'
  if (cropperInst) { cropperInst.destroy(); cropperInst = null }
}

// ─── Gallery: drop zone ────────────────────────────────────
const galleryDropZone = document.getElementById('galleryDropZone')

galleryDropZone.addEventListener('dragover',  e => { e.preventDefault(); galleryDropZone.classList.add('drag-over') })
galleryDropZone.addEventListener('dragleave', () => galleryDropZone.classList.remove('drag-over'))
galleryDropZone.addEventListener('drop', e => {
  e.preventDefault()
  galleryDropZone.classList.remove('drag-over')
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
  if (files.length) handleGalleryFiles(files)
})

document.getElementById('galleryFiles').addEventListener('change', e => {
  handleGalleryFiles(Array.from(e.target.files))
})

document.getElementById('galleryCamera').addEventListener('change', e => {
  handleGalleryFiles(Array.from(e.target.files))
})

async function handleGalleryFiles(files) {
  if (!files.length) return
  const prog     = document.getElementById('galleryProgress')
  const progBar  = document.getElementById('galleryProgressBar')
  const progText = document.getElementById('galleryProgressText')
  prog.style.display = 'flex'

  let done = 0
  for (const file of files) {
    progText.textContent = `${done} / ${files.length}`
    progBar.style.width  = (done / files.length * 100) + '%'
    try {
      const url = await uploadImageWithProgress(
        file,
        `gallery/${Date.now()}_${file.name}`,
        p => {
          const overall = (done + p) / files.length
          progBar.style.width  = Math.round(overall * 100) + '%'
          progText.textContent = `${done} / ${files.length}`
        }
      )
      // Prompt alt text (or use filename as default)
      const alt = file.name.replace(/\.[^.]+$/, '')
      galleryItems.push({ url, alt, position: 'center center' })
    } catch { /* skip failed */ }
    done++
  }

  prog.style.display = 'none'
  progBar.style.width = '0'
  renderGalleryPreview()
  initSortable()
  setStatus(`${done} bilder lastet opp!`, 'ok')
}

// ─── Gallery layout selector ───────────────────────────────
document.querySelectorAll('.layout-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    galleryLayout = btn.dataset.layout
  })
})

// ─── Gallery render ────────────────────────────────────────
function renderGalleryPreview() {
  const preview = document.getElementById('galleryPreview')
  const hint    = document.getElementById('galleryHint')
  const layoutSel = document.getElementById('galleryLayoutSelector')

  if (!galleryItems.length) {
    preview.innerHTML = ''
    hint.style.display    = 'none'
    layoutSel.style.display = 'none'
    return
  }

  hint.style.display    = 'block'
  layoutSel.style.display = 'block'

  preview.innerHTML = galleryItems.map((item, i) => `
    <div class="gallery-thumb" data-index="${i}">
      <img src="${item.url}" alt="${item.alt || ''}">
      <div class="gallery-thumb-actions">
        <button type="button" class="gallery-thumb-btn crop-btn" data-index="${i}" title="Beskjær">✂</button>
        <button type="button" class="gallery-thumb-btn alt-btn"  data-index="${i}" title="Alt-tekst">✎</button>
        <button type="button" class="gallery-thumb-btn rem-btn"  data-index="${i}" title="Fjern">×</button>
      </div>
      ${item.alt ? `<div class="gallery-alt-badge" title="${item.alt}">ALT</div>` : ''}
    </div>`).join('')

  // Bind thumb action buttons
  preview.querySelectorAll('.crop-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const idx = parseInt(btn.dataset.index)
      cropTarget = idx
      openCropModal(galleryItems[idx].url)
    })
  })

  preview.querySelectorAll('.alt-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const idx = parseInt(btn.dataset.index)
      altTarget = idx
      document.getElementById('altTextInput').value = galleryItems[idx].alt || ''
      document.getElementById('altModal').style.display = 'flex'
    })
  })

  preview.querySelectorAll('.rem-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const idx = parseInt(btn.dataset.index)
      galleryItems.splice(idx, 1)
      renderGalleryPreview()
      initSortable()
    })
  })
}

// ─── Alt text modal ────────────────────────────────────────
document.getElementById('altCancel').addEventListener('click', () => {
  document.getElementById('altModal').style.display = 'none'
})

document.getElementById('altSave').addEventListener('click', () => {
  if (altTarget !== null && galleryItems[altTarget] !== undefined) {
    galleryItems[altTarget].alt = document.getElementById('altTextInput').value.trim()
    renderGalleryPreview()
    initSortable()
  }
  document.getElementById('altModal').style.display = 'none'
})

// ─── Sortable gallery ──────────────────────────────────────
function initSortable() {
  if (sortableInst) { sortableInst.destroy(); sortableInst = null }
  const el = document.getElementById('galleryPreview')
  if (!galleryItems.length) return

  sortableInst = new Sortable(el, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(evt) {
      const moved = galleryItems.splice(evt.oldIndex, 1)[0]
      galleryItems.splice(evt.newIndex, 0, moved)
      renderGalleryPreview()
      initSortable()
    }
  })
}

// ─── Save ──────────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  const id      = document.getElementById('editId').value
  const dateVal = document.getElementById('editDate').value
  const data = {
    title:         document.getElementById('editTitle').value.trim(),
    category:      document.getElementById('editCategory').value,
    tags:          document.getElementById('editTags').value.trim(),
    body:          document.getElementById('editorBody').innerHTML,
    heroImage:     document.getElementById('heroImageUrl').value.trim() || null,
    heroPosition,
    gallery:       galleryItems,
    galleryLayout,
    published:     document.getElementById('editPublished').checked,
    date:          dateVal ? new Date(dateVal) : new Date(),
    updatedAt:     serverTimestamp(),
  }

  if (!data.title) { setStatus('Tittel er påkrevd.', 'err'); return }
  setStatus('Lagrer…')

  try {
    if (id) {
      await updateDoc(doc(db, 'articles', id), data)
    } else {
      const newRef = await addDoc(collection(db, 'articles'), { ...data, createdAt: serverTimestamp() })
      document.getElementById('editId').value = newRef.id
      document.getElementById('deleteBtn').style.display = 'block'
    }
    setStatus('✓ Lagret!', 'ok')
    await loadArticles()
  } catch (err) {
    console.error(err)
    setStatus('Feil ved lagring.', 'err')
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

// ─── Helpers ───────────────────────────────────────────────
function setStatus(msg, cls = '') {
  const el = document.getElementById('saveStatus')
  el.textContent = msg
  el.className   = 'save-status' + (cls ? ' ' + cls : '')
}

// ─── Image resize in editor ────────────────────────────────
let resizeState = null

function attachResizeHandles(img) {
  if (img.dataset.resizable) return
  img.dataset.resizable = '1'
  img.addEventListener('click', e => {
    e.stopPropagation()
    selectEditorImage(img)
  })
}

function selectEditorImage(img) {
  deselectEditorImage()
  img.classList.add('img-selected')

  const wrap = document.createElement('div')
  wrap.className = 'img-resize-wrap'
  wrap.contentEditable = 'false'
  img.parentNode.insertBefore(wrap, img)
  wrap.appendChild(img)

  // Width indicator
  const indicator = document.createElement('div')
  indicator.className = 'img-resize-indicator'
  indicator.textContent = img.offsetWidth + 'px'
  wrap.appendChild(indicator)

  // Four corner handles
  ;['nw','ne','sw','se'].forEach(pos => {
    const h = document.createElement('div')
    h.className = `img-resize-handle img-handle-${pos}`
    h.dataset.handle = pos
    wrap.appendChild(h)

    h.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      resizeState = {
        img, wrap, indicator,
        handle: pos,
        startX: e.clientX,
        startW: img.offsetWidth,
      }
      document.addEventListener('mousemove', onResizeMove)
      document.addEventListener('mouseup',   onResizeUp)
    })

    h.addEventListener('touchstart', e => {
      e.preventDefault()
      const t = e.touches[0]
      resizeState = {
        img, wrap, indicator,
        handle: pos,
        startX: t.clientX,
        startW: img.offsetWidth,
      }
      document.addEventListener('touchmove', onResizeTouchMove, { passive: false })
      document.addEventListener('touchend',  onResizeTouchUp)
    }, { passive: false })
  })
}

function applyResize(clientX) {
  if (!resizeState) return
  const { img, wrap, indicator, handle, startX, startW } = resizeState
  const sign = (handle === 'ne' || handle === 'se') ? 1 : -1
  const newW = Math.max(60, Math.min(startW + sign * (clientX - startX), 1200))
  img.style.width  = newW + 'px'
  img.style.height = 'auto'
  wrap.style.width = newW + 'px'
  indicator.textContent = Math.round(newW) + 'px'
  indicator.style.opacity = '1'
}

function onResizeMove(e)      { applyResize(e.clientX) }
function onResizeTouchMove(e) { e.preventDefault(); applyResize(e.touches[0].clientX) }

function onResizeUp() {
  if (resizeState?.indicator) resizeState.indicator.style.opacity = '0'
  resizeState = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup',   onResizeUp)
}
function onResizeTouchUp() {
  resizeState = null
  document.removeEventListener('touchmove', onResizeTouchMove)
  document.removeEventListener('touchend',  onResizeTouchUp)
}

function deselectEditorImage() {
  document.querySelectorAll('.img-resize-wrap').forEach(wrap => {
    const img = wrap.querySelector('img')
    if (img) wrap.parentNode.insertBefore(img, wrap)
    wrap.remove()
  })
  document.querySelectorAll('.img-selected').forEach(el => el.classList.remove('img-selected'))
}

document.getElementById('editorBody').addEventListener('click', e => {
  if (!e.target.closest('img')) deselectEditorImage()
})

// Watch for new images inserted via paste/toolbar/upload
const editorObserver = new MutationObserver(() => {
  document.querySelectorAll('#editorBody img').forEach(attachResizeHandles)
})
editorObserver.observe(document.getElementById('editorBody'), {
  childList: true, subtree: true,
})

// Call this after openEditor() to attach handles to existing images
function attachAllEditorImages() {
  document.querySelectorAll('#editorBody img').forEach(attachResizeHandles)
}
