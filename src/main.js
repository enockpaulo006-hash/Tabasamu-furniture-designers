import './style.css'
import { db, auth } from './firebase.js'

import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'

// ==========================================
// CONFIGURATION
// ==========================================

const OWNER_EMAIL = 'emanuelyh39@gmail.com'
const WHATSAPP_NUMBER = '255622069561'

const CLOUDINARY_CLOUD_NAME = 'tgmrkkbc'
const CLOUDINARY_UPLOAD_PRESET = 'tabasamu_furniture'

const CLOUDINARY_UPLOAD_URL =
  `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`

const MAX_IMAGE_SIZE = 10 * 1024 * 1024
const MAX_IMAGES_PER_UPLOAD = 10

const MAX_IMAGE_DIMENSION = 1600
const IMAGE_QUALITY = 0.82

const CACHE_KEY_PUBLIC = 'tabasamu_public_products_v1'
const CACHE_KEY_OWNER = 'tabasamu_owner_products_v1'
const CACHE_DURATION = 6 * 60 * 60 * 1000

// ==========================================
// APPLICATION STATE
// ==========================================

let products = []

let currentPage = 'home'
let currentUser = null
let slideshowIndex = 0
let slideshowTimer = null
let toastTimer = null
let previewURLs = []

const app = document.querySelector('#app')

// ==========================================
// OWNER AUTHORIZATION
// ==========================================

function isOwner(user) {
  return Boolean(
    user &&
    user.email &&
    user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()
  )
}

// ==========================================
// SAFE CONTENT HELPERS
// ==========================================

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function safeImageURL(value) {
  try {
    const url = new URL(value)

    if (url.protocol === 'https:') {
      return url.href
    }
  } catch {
    // Invalid URL
  }

  return ''
}

function getCreatedTime(product) {
  if (product.createdAt?.toMillis) {
    return product.createdAt.toMillis()
  }

  if (typeof product.createdAt === 'number') {
    return product.createdAt
  }

  return 0
}

function getImage(product) {
  return safeImageURL(product.image || product.imageUrl || '')
}

// ==========================================
// CLOUDINARY IMAGE OPTIMIZATION
// ==========================================

function getOptimizedImageURL(value, width = 1000) {
  const safeURL = safeImageURL(value)

  if (!safeURL) return ''

  try {
    const url = new URL(safeURL)

    if (!url.hostname.endsWith('cloudinary.com')) {
      return safeURL
    }

    const uploadPath = '/image/upload/'

    if (!url.pathname.includes(uploadPath)) {
      return safeURL
    }

    const transformations =
      `f_auto,q_auto,w_${width},c_limit`

    url.pathname = url.pathname.replace(
      uploadPath,
      `${uploadPath}${transformations}/`
    )

    return url.href
  } catch {
    return safeURL
  }
}

function imageAttributes(product, width = 1000) {
  const image = getOptimizedImageURL(getImage(product), width)

  return `src="${escapeHTML(image)}" loading="lazy" decoding="async"`
}

// ==========================================
// LOCAL PRODUCT CACHE
// ==========================================

function getCacheKey() {
  return isOwner(auth.currentUser)
    ? CACHE_KEY_OWNER
    : CACHE_KEY_PUBLIC
}

function saveProductsToCache(items) {
  try {
    const cache = {
      savedAt: Date.now(),
      products: items.map((product) => ({
        ...product,
        createdAt: getCreatedTime(product),
        updatedAt: product.updatedAt?.toMillis
          ? product.updatedAt.toMillis()
          : null,
      })),
    }

    localStorage.setItem(getCacheKey(), JSON.stringify(cache))
  } catch (error) {
    console.warn('Could not save furniture cache:', error)
  }
}

function readProductsFromCache() {
  try {
    const raw = localStorage.getItem(getCacheKey())

    if (!raw) return null

    const cache = JSON.parse(raw)

    if (!cache.savedAt || !Array.isArray(cache.products)) {
      return null
    }

    if (Date.now() - cache.savedAt > CACHE_DURATION) {
      return null
    }

    return cache.products
      .filter((product) => {
        return isOwner(auth.currentUser) || product.active === true
      })
      .filter((product) => getImage(product))
      .sort((a, b) => getCreatedTime(b) - getCreatedTime(a))
  } catch (error) {
    console.warn('Could not read furniture cache:', error)
    return null
  }
}

function clearProductCache() {
  try {
    localStorage.removeItem(CACHE_KEY_PUBLIC)
    localStorage.removeItem(CACHE_KEY_OWNER)
  } catch (error) {
    console.warn('Could not clear cache:', error)
  }
}

// ==========================================
// ICONS
// ==========================================

const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></svg>',

  gallery: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',

  admin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>',

  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>',

  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',

  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
}

// ==========================================
// APPLICATION SHELL
// ==========================================

function renderShell() {
  app.innerHTML = `
    <header class="top-header">

      <a href="#" class="brand" data-page="home">
        <img src="/tabasamu-logo.png" alt="Tabasamu logo">

        <span>
          <strong>TABASAMU</strong>
          <small>FURNITURE DESIGNERS</small>
        </span>
      </a>

      <a
        class="header-contact"
        href="https://wa.me/${WHATSAPP_NUMBER}"
        target="_blank"
        rel="noopener noreferrer"
      >
        Contact us
      </a>

    </header>

    <nav class="bottom-nav" id="bottom-nav">

      <button class="nav-item" data-page="home">
        ${icons.home}
        <span>Home</span>
      </button>

      <button class="nav-item" data-page="gallery">
        ${icons.gallery}
        <span>Gallery</span>
      </button>

      ${isOwner(currentUser) ? `
        <button class="nav-item" data-page="admin">
          ${icons.admin}
          <span>Admin</span>
        </button>
      ` : ''}

    </nav>

    <main id="page-content"></main>

    <footer class="site-footer">
      <p>© ${new Date().getFullYear()} Tabasamu Furniture Designers</p>
    </footer>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>

    <div
      class="image-lightbox"
      id="image-lightbox"
      aria-hidden="true"
      role="dialog"
      aria-modal="true"
      aria-label="Expanded furniture image"
    >
      <button
        class="lightbox-close"
        id="lightbox-close"
        type="button"
        aria-label="Close image preview"
      >&times;</button>
      <img id="lightbox-image" src="" alt="Expanded furniture design">
    </div>

    <style>
      .image-lightbox {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 55px 14px 20px;
        background: rgba(15, 12, 10, .94);
      }
      .image-lightbox.open {
        display: flex;
      }
      .image-lightbox > img {
        display: block;
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        object-fit: contain;
        border-radius: 5px;
      }
      .lightbox-close {
        position: absolute;
        top: 12px;
        right: 16px;
        width: 42px;
        height: 42px;
        border: 0;
        border-radius: 50%;
        background: rgba(255,255,255,.16);
        color: white;
        font-size: 32px;
        line-height: 1;
      }
      [data-preview-image] {
        cursor: zoom-in;
      }
      body.lightbox-open {
        overflow: hidden;
      }
    </style>
  `
}

// ==========================================
// NOTIFICATIONS
// ==========================================

function showToast(message) {
  const toast = document.querySelector('#toast')
  if (!toast) return

  toast.textContent = message
  toast.classList.add('visible')

  clearTimeout(toastTimer)

  toastTimer = setTimeout(() => {
    toast.classList.remove('visible')
  }, 3500)
}

// ==========================================
// NAVIGATION
// ==========================================

function navigate(page) {
  if (page === 'admin' && !isOwner(currentUser)) {
    page = 'login'
  }

  currentPage = page
  renderPage()

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  })
}

function openImagePreview(imageURL, altText = 'Furniture design') {
  const lightbox = document.querySelector('#image-lightbox')
  const lightboxImage = document.querySelector('#lightbox-image')

  if (!lightbox || !lightboxImage || !imageURL) return

  lightboxImage.src = imageURL
  lightboxImage.alt = altText
  lightbox.classList.add('open')
  lightbox.setAttribute('aria-hidden', 'false')
  document.body.classList.add('lightbox-open')
}

function closeImagePreview() {
  const lightbox = document.querySelector('#image-lightbox')
  const lightboxImage = document.querySelector('#lightbox-image')

  if (!lightbox || !lightboxImage) return

  lightbox.classList.remove('open')
  lightbox.setAttribute('aria-hidden', 'true')
  lightboxImage.src = ''
  document.body.classList.remove('lightbox-open')
}

app.addEventListener('click', (event) => {
  const previewImage = event.target.closest('[data-preview-image]')

  if (previewImage) {
    event.preventDefault()
    event.stopPropagation()
    openImagePreview(
      previewImage.dataset.previewImage,
      previewImage.alt || 'Furniture design'
    )
    return
  }

  if (
    event.target.closest('#lightbox-close') ||
    event.target.id === 'image-lightbox'
  ) {
    closeImagePreview()
    return
  }

  const button = event.target.closest('[data-page]')
  if (!button) return

  event.preventDefault()
  navigate(button.dataset.page)
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeImagePreview()
  }
})

// ==========================================
// FIRESTORE IMAGE COLLECTION
// ==========================================

async function loadProducts(options = {}) {
  const { showCachedFirst = true } = options

  if (showCachedFirst) {
    const cachedProducts = readProductsFromCache()

    if (cachedProducts) {
      products = cachedProducts
      renderPage()
    }
  }

  try {
    const productsQuery = isOwner(auth.currentUser)
      ? collection(db, 'products')
      : query(
          collection(db, 'products'),
          where('active', '==', true)
        )

    const snapshot = await getDocs(productsQuery)

    products = snapshot.docs
      .map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      .filter((product) => getImage(product))
      .sort((a, b) => getCreatedTime(b) - getCreatedTime(a))

    saveProductsToCache(products)

    console.log('Furniture images loaded:', products.length)

  } catch (error) {
    console.error('Firestore loading failed:', error)

    if (!products.length) {
      showToast(
        'Could not load designs. Check your internet connection and Firestore rules.'
      )
    }
  }

  renderPage()
}

// ==========================================
// HOME PAGE
// ==========================================

function renderHome() {
  const content = document.querySelector('#page-content')

  const featured = products.slice(0, 5)

  const popularProduct = [...products].sort(
    (a, b) => (b.selections || 0) - (a.selections || 0)
  )[0]

  const recentProduct = [...products].sort(
    (a, b) => getCreatedTime(b) - getCreatedTime(a)
  )[0]

  content.innerHTML = `
    <section class="home-page">

      <div class="welcome-text">
        <span class="eyebrow">WELCOME TO TABASAMU</span>

        <h1>
          Beautiful furniture.
          <br>
        </h1>

        <p>
          Discover furniture designs crafted to make your space special.
        </p>
      </div>

      ${featured.length ? `
        <section class="slideshow" id="slideshow">

          <img
            id="slide-image"
            src="${escapeHTML(getOptimizedImageURL(getImage(featured[0]), 1400))}"
            alt="Featured furniture design"
            loading="eager"
            fetchpriority="high"
            decoding="async"
          >

          <div class="slide-overlay">
            <span>FEATURED DESIGN</span>

            <h2 id="slide-title">Discover our designs</h2>

            <button class="slide-button" data-page="gallery">
              Explore designs ${icons.arrow}
            </button>
          </div>

          <button
            class="slide-control slide-prev"
            id="slide-prev"
            aria-label="Previous slide"
          >
            ${icons.left}
          </button>

          <button
            class="slide-control slide-next"
            id="slide-next"
            aria-label="Next slide"
          >
            ${icons.right}
          </button>

          <div class="slide-dots" id="slide-dots"></div>

        </section>
      ` : `
        <div class="empty-message">
          <p>Our furniture collection is coming soon.</p>
          <button class="primary-button" data-page="gallery">
            Explore gallery
          </button>
        </div>
      `}

      <section class="featured-section">

        <div class="section-title">
          <div>
            <span class="eyebrow">EXPLORE OUR COLLECTIONS</span>
            <h2>Featured designs</h2>
          </div>

          <button class="text-link" data-page="gallery">
            View all
          </button>
        </div>

        <div class="feature-cards">

          ${renderFeatureCard(
            'popular',
            'Most selected designs',
            popularProduct
          )}

          ${renderFeatureCard(
            'recent',
            'Recently uploaded',
            recentProduct
          )}

        </div>

      </section>

    </section>
  `

  if (featured.length) {
    startSlideshow(featured)
  }
}

function renderFeatureCard(type, title, product) {
  if (!product) {
    return `
      <div class="feature-card">
        <div class="feature-info">
          <strong>${escapeHTML(title)}</strong>
          <small>Designs will appear here</small>
        </div>
      </div>
    `
  }

  return `
    <button class="feature-card" data-page="gallery">

      <div class="feature-image">
        <img
          ${imageAttributes(product, 600)}
          data-preview-image="${escapeHTML(getOptimizedImageURL(getImage(product), 1800))}"
          alt="Furniture design"
        >

        <span class="feature-tag">
          ${type === 'popular' ? 'POPULAR' : 'NEW'}
        </span>
      </div>

      <div class="feature-info">
        <strong>${escapeHTML(title)}</strong>
      </div>

    </button>
  `
}

// ==========================================
// SLIDESHOW
// ==========================================

function startSlideshow(slides) {
  clearInterval(slideshowTimer)

  if (!slides.length) return

  slideshowIndex = 0

  const image = document.querySelector('#slide-image')
  const dots = document.querySelector('#slide-dots')

  if (!image || !dots) return

  function showSlide(index) {
    slideshowIndex = (index + slides.length) % slides.length

    image.src = getOptimizedImageURL(
      getImage(slides[slideshowIndex]),
      1400
    )

    dots.innerHTML = slides.map((_, i) => `
      <button
        class="slide-dot ${i === slideshowIndex ? 'active' : ''}"
        data-slide="${i}"
        aria-label="Show slide ${i + 1}"
      ></button>
    `).join('')
  }

  document.querySelector('#slide-prev')?.addEventListener('click', () => {
    showSlide(slideshowIndex - 1)
  })

  document.querySelector('#slide-next')?.addEventListener('click', () => {
    showSlide(slideshowIndex + 1)
  })

  dots.addEventListener('click', (event) => {
    const dot = event.target.closest('[data-slide]')
    if (dot) showSlide(Number(dot.dataset.slide))
  })

  showSlide(0)

  if (slides.length > 1) {
    slideshowTimer = setInterval(() => {
      showSlide(slideshowIndex + 1)
    }, 4500)
  }
}

// ==========================================
// GALLERY
// ==========================================

function renderGallery() {
  const content = document.querySelector('#page-content')

  content.innerHTML = `
    <section class="inner-page">

      <div class="page-heading">
        <span class="eyebrow">OUR COLLECTION</span>
        <h1>Furniture gallery</h1>
        <p>Choose the designs you would love in your space.</p>
      </div>

      <div class="product-grid" id="product-grid"></div>

    </section>
  `

  renderProducts()
}

function renderProducts() {
  const grid = document.querySelector('#product-grid')
  if (!grid) return

  grid.innerHTML = products.map((product) => `
    <article class="product-card">
      <div class="product-image">
        <img
          ${imageAttributes(product, 700)}
          data-preview-image="${escapeHTML(getOptimizedImageURL(getImage(product), 1800))}"
          alt="Furniture design"
        >
      </div>
    </article>
  `).join('') || `
    <p class="empty-message">
      No furniture images have been published yet.
    </p>
  `
}

// ==========================================
// OWNER LOGIN
// ==========================================

function renderLogin() {
  const content = document.querySelector('#page-content')

  content.innerHTML = `
    <section class="inner-page login-page">

      <div class="login-card">
        <span class="eyebrow">OWNER ACCESS</span>

        <h1>Welcome back</h1>

        <p>Sign in to manage Tabasamu furniture designs.</p>

        <form id="login-form">

          <label for="owner-email">Email address</label>
          <input
            id="owner-email"
            type="email"
            required
            placeholder="Owner email"
            autocomplete="username"
          >

          <label for="owner-password">Password</label>
          <input
            id="owner-password"
            type="password"
            required
            placeholder="Your password"
            autocomplete="current-password"
          >

          <button class="primary-button" type="submit">
            Sign in
          </button>

          <p id="login-error" class="error-message"></p>

        </form>

        <button class="back-button" id="back-home">
          Back to home
        </button>
      </div>

    </section>
  `

  document.querySelector('#login-form').addEventListener(
    'submit',
    async (event) => {
      event.preventDefault()

      const email = document.querySelector('#owner-email').value.trim()
      const password = document.querySelector('#owner-password').value
      const error = document.querySelector('#login-error')

      const submitButton =
        event.currentTarget.querySelector('button[type="submit"]')

      error.textContent = ''

      if (email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        error.textContent =
          'Access denied. This account is not authorised.'
        return
      }

      submitButton.disabled = true
      submitButton.textContent = 'Signing in...'

      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          email,
          password
        )

        if (!isOwner(credential.user)) {
          await signOut(auth)

          error.textContent =
            'Access denied. This account is not authorised.'

          submitButton.disabled = false
          submitButton.textContent = 'Sign in'
          return
        }

        currentUser = credential.user
        currentPage = 'admin'

        await loadProducts({ showCachedFirst: false })

        showToast('Welcome to the Admin dashboard.')

      } catch (err) {
        console.error('Login failed:', err)

        error.textContent =
          'Login failed. Check your email and password.'

        submitButton.disabled = false
        submitButton.textContent = 'Sign in'
      }
    }
  )

  document.querySelector('#back-home').addEventListener('click', () => {
    navigate('home')
  })
}

// ==========================================
// IMAGE COMPRESSION
// ==========================================

async function compressImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Invalid image file.')
  }

  let bitmap

  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error(
      'This image format cannot be processed by your browser. Try JPG or PNG.'
    )
  }

  try {
    const originalWidth = bitmap.width
    const originalHeight = bitmap.height

    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight)
    )

    const width = Math.round(originalWidth * scale)
    const height = Math.round(originalHeight * scale)

    const canvas = document.createElement('canvas')

    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Image compression is not supported.')
    }

    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result)
          } else {
            reject(new Error('Could not compress this image.'))
          }
        },
        'image/webp',
        IMAGE_QUALITY
      )
    })

    if (blob.type !== 'image/webp') {
      throw new Error('Your browser does not support WEBP conversion.')
    }

    const compressedFile = new File(
      [blob],
      `${file.name.replace(/\.[^/.]+$/, '')}.webp`,
      {
        type: 'image/webp',
        lastModified: Date.now(),
      }
    )

    console.log(
      `Image compressed: ${(file.size / 1024).toFixed(1)} KB → ${(compressedFile.size / 1024).toFixed(1)} KB`
    )

    return compressedFile

  } finally {
    bitmap.close()
  }
}

// ==========================================
// CLOUDINARY IMAGE UPLOAD
// ==========================================

async function uploadImageToCloudinary(file) {
  const compressedFile = await compressImage(file)

  const formData = new FormData()

  formData.append('file', compressedFile)
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
  formData.append('folder', 'tabasamu/designs')

  const response = await fetch(CLOUDINARY_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  })

  const result = await response.json()

  if (!response.ok) {
    console.error('Cloudinary upload error:', result)

    throw new Error(
      result.error?.message || 'Cloudinary image upload failed.'
    )
  }

  if (!result.secure_url) {
    throw new Error('Cloudinary did not return an image URL.')
  }

  return result
}

// ==========================================
// OWNER ADMIN
// ==========================================

function renderAdmin() {
  const content = document.querySelector('#page-content')

  if (!isOwner(currentUser)) {
    currentPage = 'home'
    renderPage()
    return
  }

  content.innerHTML = `
    <section class="inner-page admin-page">

      <div class="page-heading">
        <span class="eyebrow">OWNER DASHBOARD</span>
        <h1>Welcome, Admin</h1>
        <p>${escapeHTML(currentUser.email || '')}</p>
      </div>

      <section class="admin-panel">

        <form id="image-upload-form" class="admin-product-form">

          <label for="furniture-images">
            Select furniture images
          </label>

          <input
            id="furniture-images"
            name="images"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            required
          >

          <p class="admin-help">
            Maximum ${MAX_IMAGES_PER_UPLOAD} images per upload.
          </p>

          <div
            id="image-preview-list"
            class="admin-image-preview"
          >
          </div>

          <label class="admin-checkbox-label">
            <input
              id="publish-images"
              type="checkbox"
              checked
            >
            Publish images in the public Gallery
          </label>

          <div class="admin-form-actions">
            <button
              class="primary-button"
              id="upload-images-button"
              type="submit"
            >
              Upload and publish images
            </button>
          </div>

          <p
            id="upload-message"
            class="error-message"
            role="status"
            aria-live="polite"
          ></p>

        </form>

      </section>

      <section class="admin-products-section">

        <div class="section-title">
          <div>
            <span class="eyebrow">YOUR COLLECTION</span>
            <h2>Manage images</h2>
          </div>

          <button
            class="text-link"
            id="refresh-products-button"
            type="button"
          >
            Refresh
          </button>
        </div>

        <div id="admin-product-list" class="admin-product-list">
          <p>Loading images...</p>
        </div>

      </section>

      <button
        class="logout-button"
        id="logout-button"
        type="button"
      >
        Sign out
      </button>

    </section>
  `

  const form = document.querySelector('#image-upload-form')
  const fileInput = document.querySelector('#furniture-images')
  const previewList = document.querySelector('#image-preview-list')
  const message = document.querySelector('#upload-message')
  const uploadButton = document.querySelector('#upload-images-button')

  function clearPreviews() {
    previewURLs.forEach((url) => URL.revokeObjectURL(url))
    previewURLs = []
  }

  function showImagePreviews() {
    clearPreviews()

    const files = Array.from(fileInput.files || [])

    if (!files.length) {
      previewList.innerHTML =
        '<span>Selected image previews will appear here.</span>'
      return
    }

    previewList.innerHTML = files.map((file) => {
      const url = URL.createObjectURL(file)
      previewURLs.push(url)

      return `
        <div class="admin-preview-item">
          <img
            src="${escapeHTML(url)}"
            alt="Selected furniture image"
          >
        </div>
      `
    }).join('')
  }

  fileInput.addEventListener('change', showImagePreviews)

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    if (!isOwner(auth.currentUser)) {
      message.textContent =
        'Your owner session has expired. Please sign in again.'
      return
    }

    const files = Array.from(fileInput.files || [])
    const active = document.querySelector('#publish-images').checked

    if (!files.length) {
      message.textContent = 'Please select at least one image.'
      return
    }

    if (files.length > MAX_IMAGES_PER_UPLOAD) {
      message.textContent =
        `Please select no more than ${MAX_IMAGES_PER_UPLOAD} images at once.`
      return
    }

    const invalidFile = files.find((file) =>
      !['image/jpeg', 'image/png', 'image/webp', 'image/avif']
        .includes(file.type)
    )

    if (invalidFile) {
      message.textContent =
        'Please select JPG, PNG, WEBP or AVIF image files only.'
      return
    }

    const oversizedFile = files.find(
      (file) => file.size > MAX_IMAGE_SIZE
    )

    if (oversizedFile) {
      message.textContent =
        'Each original image must be 10 MB or smaller.'
      return
    }

    uploadButton.disabled = true
    message.textContent = ''

    let successfulUploads = 0
    const errors = []

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]

        uploadButton.textContent =
          `Compressing and uploading ${index + 1} of ${files.length}...`

        try {
          const cloudinaryResult =
            await uploadImageToCloudinary(file)

          await addDoc(collection(db, 'products'), {
            image: cloudinaryResult.secure_url,
            publicId: cloudinaryResult.public_id,
            format: cloudinaryResult.format || 'webp',
            bytes: cloudinaryResult.bytes || 0,
            active,
            selections: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })

          successfulUploads++

        } catch (error) {
          console.error('Image upload failed:', error)
          errors.push(`${file.name}: ${error.message}`)
        }
      }

      clearProductCache()

      await loadProducts({ showCachedFirst: false })

      fileInput.value = ''
      clearPreviews()
      showImagePreviews()

      if (successfulUploads === files.length) {
        message.textContent = ''

        showToast(
          `${successfulUploads} image(s) uploaded successfully.`
        )

      } else if (successfulUploads > 0) {
        message.textContent =
          `${successfulUploads} image(s) uploaded. ${errors.length} failed.`

        showToast('Some images could not be uploaded.')

      } else {
        message.textContent =
          errors[0] || 'No images could be uploaded.'
      }

    } catch (error) {
      console.error('Upload process failed:', error)

      message.textContent =
        'An unexpected error occurred. Please try again.'

    } finally {
      uploadButton.disabled = false
      uploadButton.textContent = 'Upload and publish images'
    }
  })

  document.querySelector('#refresh-products-button')
    .addEventListener('click', async () => {
      clearProductCache()
      await loadProducts({ showCachedFirst: false })
    })

  document.querySelector('#logout-button')
    .addEventListener('click', async () => {
      try {
        await signOut(auth)

        currentUser = null
        currentPage = 'home'

        renderPage()
        showToast('Signed out.')

      } catch (error) {
        console.error('Sign out failed:', error)
        showToast('Could not sign out. Please try again.')
      }
    })

  renderAdminProductList()
}

// ==========================================
// ADMIN IMAGE LIST
// ==========================================

function renderAdminProductList() {
  const list = document.querySelector('#admin-product-list')
  if (!list) return

  if (!isOwner(auth.currentUser)) {
    list.innerHTML = '<p>Owner access required.</p>'
    return
  }

  if (!products.length) {
    list.innerHTML = `
      <p>
        No furniture images have been uploaded yet.
      </p>
    `
    return
  }

  list.innerHTML = products.map((product) => `
    <article class="admin-product-item">

      <img
        ${imageAttributes(product, 500)}
        data-preview-image="${escapeHTML(getOptimizedImageURL(getImage(product), 1800))}"
        alt="Furniture design"
      >

      <div class="admin-product-details">
        <strong>Furniture image</strong>

        <small>
          ${product.active === false ? 'Not published' : 'Published'}
        </small>

        <small>
          ${Number(product.selections || 0)} selection(s)
        </small>
      </div>

      <div class="admin-product-actions">
        <button
          type="button"
          data-toggle-publish="${escapeHTML(product.id)}"
        >
          ${product.active === false ? 'Publish' : 'Unpublish'}
        </button>

        <button
          type="button"
          data-delete-product="${escapeHTML(product.id)}"
        >
          Delete
        </button>
      </div>

    </article>
  `).join('')

  // Publish or unpublish an image.
  list.querySelectorAll('[data-toggle-publish]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!isOwner(auth.currentUser)) return

      const productId = button.dataset.togglePublish
      const product = products.find((item) => item.id === productId)

      if (!product) return

      button.disabled = true

      try {
        const nextActive = product.active === false

        await updateDoc(doc(db, 'products', productId), {
          active: nextActive,
          updatedAt: serverTimestamp(),
        })

        product.active = nextActive

        clearProductCache()
        saveProductsToCache(products)

        renderAdminProductList()

        showToast(
          nextActive ? 'Image published.' : 'Image unpublished.'
        )

      } catch (error) {
        console.error('Could not update image:', error)

        showToast('Could not update image. Check Firestore rules.')

        button.disabled = false
      }
    })
  })

  // Delete an image record from Firestore.
  list.querySelectorAll('[data-delete-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!isOwner(auth.currentUser)) return

      const productId = button.dataset.deleteProduct

      const confirmed = window.confirm(
        'Remove this image from the website?'
      )

      if (!confirmed) return

      button.disabled = true

      try {
        await deleteDoc(doc(db, 'products', productId))

        products = products.filter(
          (item) => item.id !== productId
        )

        clearProductCache()
        saveProductsToCache(products)

        renderAdminProductList()

        showToast('Image removed from the website.')

      } catch (error) {
        console.error('Could not delete image:', error)

        showToast('Could not delete image. Check Firestore rules.')

        button.disabled = false
      }
    })
  })
}

// ==========================================
// PAGE RENDERER
// ==========================================

function renderPage() {
  clearInterval(slideshowTimer)

  if (currentPage === 'admin' && !isOwner(currentUser)) {
    currentPage = 'login'
  }

  renderShell()

  switch (currentPage) {
    case 'gallery':
      renderGallery()
      break

    case 'login':
      renderLogin()
      break

    case 'admin':
      renderAdmin()
      break

    default:
      currentPage = 'home'
      renderHome()
  }

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle(
      'active',
      item.dataset.page === currentPage
    )
  })
}

// ==========================================
// PRIVATE OWNER LOGIN URL
// ==========================================

function handleHashRoute() {
  if (window.location.hash === '#owner') {
    if (isOwner(currentUser)) {
      navigate('admin')
    } else {
      navigate('login')
    }
  }
}

window.addEventListener('hashchange', handleHashRoute)

// ==========================================
// AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async (user) => {
  if (user && !isOwner(user)) {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Could not sign out unauthorised account:', error)
    }

    currentUser = null

    if (currentPage === 'admin') {
      currentPage = 'home'
    }

    renderPage()

    showToast('This account is not authorised for Admin access.')
    return
  }

  currentUser = user

  if (!user && currentPage === 'admin') {
    currentPage = 'home'
  }

  if (user && currentPage === 'login') {
    currentPage = 'admin'
  }

  await loadProducts()

  if (window.location.hash === '#owner' && !user) {
    navigate('login')
  }
})

// ==========================================
// START APPLICATION
// ==========================================

renderPage()