
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
  increment,
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

// ==========================================
// APPLICATION STATE
// ==========================================

let products = []
const selectedDesigns = new Set()

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
// ICONS
// ==========================================

const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></svg>',

  gallery: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',

  basket: '<svg viewBox="0 0 24 24"><path d="M3 9h18l-2 12H5L3 9Z"/><path d="m8 9 4-6 4 6M9 13v4m6-4v4"/></svg>',

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

      <button class="nav-item" data-page="basket">
        ${icons.basket}
        <span>Basket <b id="nav-count">0</b></span>
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
  `

  updateBasketCount()
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

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-page]')
  if (!button) return

  event.preventDefault()
  navigate(button.dataset.page)
})

// ==========================================
// FIRESTORE IMAGE COLLECTION
// ==========================================

async function loadProducts() {
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

    // Remove selections for designs that are no longer available.
    for (const id of selectedDesigns) {
      if (!products.some((product) => product.id === id)) {
        selectedDesigns.delete(id)
      }
    }

    console.log('Furniture images loaded:', products.length)

  } catch (error) {
    console.error('Firestore loading failed:', error)

    products = []

    showToast(
      'Could not load designs. Check your internet connection and Firestore rules.'
    )
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
          <em>Beautiful living.</em>
        </h1>

        <p>
          Discover furniture designs crafted to make your space special.
        </p>
      </div>

      ${featured.length ? `
        <section class="slideshow" id="slideshow">

          <img
            id="slide-image"
            src="${escapeHTML(getImage(featured[0]))}"
            alt="Featured furniture design"
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
            <span class="eyebrow">EXPLORE OUR COLLECTION</span>
            <h2>Featured designs</h2>
          </div>

          <button class="text-link" data-page="gallery">
            View all →
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
          src="${escapeHTML(getImage(product))}"
          alt="Furniture design"
          loading="lazy"
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

    image.src = getImage(slides[slideshowIndex])

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

  grid.innerHTML = products.map((product) => {
    const selected = selectedDesigns.has(product.id)

    return `
      <article class="product-card">

        <div class="product-image">
          <img
            src="${escapeHTML(getImage(product))}"
            alt="Furniture design"
            loading="lazy"
          >
        </div>

        <div class="product-info">

          <button
            class="select-button ${selected ? 'selected' : ''}"
            data-select="${escapeHTML(product.id)}"
          >
            ${selected ? '✓ Selected' : '+ Select design'}
          </button>

        </div>

      </article>
    `
  }).join('') || `
    <p class="empty-message">
      No furniture images have been published yet.
    </p>
  `

  grid.querySelectorAll('[data-select]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.select

      if (selectedDesigns.has(id)) {
        selectedDesigns.delete(id)
        showToast('Design removed from basket.')
      } else {
        selectedDesigns.add(id)
        showToast('Design added to basket.')

        // Update the popularity count in Firestore.
        try {
          await updateDoc(doc(db, 'products', id), {
            selections: increment(1),
          })

          const product = products.find((item) => item.id === id)

          if (product) {
            product.selections = (product.selections || 0) + 1
          }
        } catch (error) {
          console.error('Could not update selection count:', error)
        }
      }

      renderProducts()
      updateBasketCount()
    })
  })
}

// ==========================================
// BASKET
// ==========================================

function renderBasket() {
  const content = document.querySelector('#page-content')

  const selected = products.filter((product) =>
    selectedDesigns.has(product.id)
  )

  content.innerHTML = `
    <section class="inner-page">

      <div class="page-heading">
        <span class="eyebrow">YOUR SELECTION</span>
        <h1>My basket</h1>
        <p>Review your favourite furniture designs.</p>
      </div>

      <div class="basket-products">

        ${selected.length ? selected.map((product) => `
          <article class="basket-product">

            <img
              src="${escapeHTML(getImage(product))}"
              alt="Selected furniture design"
            >

            <div>
              <strong>Selected design</strong>
              <small>Furniture design</small>
            </div>

            <button
              class="remove-button"
              data-remove="${escapeHTML(product.id)}"
            >
              Remove
            </button>

          </article>
        `).join('') : `
          <div class="empty-basket">
            <div class="empty-icon">${icons.basket}</div>
            <h2>Your basket is empty</h2>
            <p>Explore our gallery and select designs you like.</p>

            <button class="primary-button" data-page="gallery">
              Explore gallery
            </button>
          </div>
        `}

      </div>

      ${selected.length ? `
        <div class="basket-summary">
          <strong>${selected.length} design(s) selected</strong>

          <button class="primary-button" id="send-inquiry">
            Request quotation ${icons.arrow}
          </button>
        </div>
      ` : ''}

    </section>
  `

  content.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedDesigns.delete(button.dataset.remove)
      renderBasket()
      updateBasketCount()
      showToast('Design removed from basket.')
    })
  })

  document.querySelector('#send-inquiry')?.addEventListener(
    'click',
    sendInquiry
  )
}

// ==========================================
// WHATSAPP QUOTATION REQUEST
// ==========================================

function sendInquiry() {
  const selected = products.filter((product) =>
    selectedDesigns.has(product.id)
  )

  if (!selected.length) return

  const list = selected.map((product, index) =>
    `${index + 1}. Selected furniture design`
  ).join('\n')

  const message = `
Hello Tabasamu Furniture Designers!

I would like to enquire about these furniture designs:

${list}

Please contact me with more information.

Thank you!
  `.trim()

  const url =
    `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`

  window.open(url, '_blank', 'noopener,noreferrer')
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
          return
        }

        currentUser = credential.user
        currentPage = 'admin'

        await loadProducts()

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
// CLOUDINARY IMAGE UPLOAD
// ==========================================

async function uploadImageToCloudinary(file) {
  const formData = new FormData()

  formData.append('file', file)
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

        <h2>Upload furniture images</h2>

        <p>
          Select one or several furniture images from your device.
          Published images will appear in the public Gallery.
        </p>

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
            Each image must be 10 MB or smaller.
          </p>

          <div
            id="image-preview-list"
            class="admin-image-preview"
          >
            <span>Selected image previews will appear here.</span>
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
        'Each image must be 10 MB or smaller.'
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
          `Uploading ${index + 1} of ${files.length}...`

        try {
          // First upload the image to Cloudinary.
          const cloudinaryResult =
            await uploadImageToCloudinary(file)

          // Then save its URL and metadata in Firestore.
          await addDoc(collection(db, 'products'), {
            image: cloudinaryResult.secure_url,
            publicId: cloudinaryResult.public_id,
            format: cloudinaryResult.format || '',
            bytes: cloudinaryResult.bytes || file.size,
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

      await loadProducts()

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
      await loadProducts()
      renderAdminProductList()
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
        Select images above to publish your first designs.
      </p>
    `
    return
  }

  list.innerHTML = products.map((product) => `
    <article class="admin-product-item">

      <img
        src="${escapeHTML(getImage(product))}"
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

        selectedDesigns.delete(productId)

        renderAdminProductList()
        updateBasketCount()

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

    case 'basket':
      renderBasket()
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

  updateBasketCount()
}

// ==========================================
// BASKET COUNT
// ==========================================

function updateBasketCount() {
  const count = document.querySelector('#nav-count')

  if (count) {
    count.textContent = selectedDesigns.size
  }
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
// START
// ==========================================

renderPage()
