
import './style.css'
import { db } from './firebase.js'
import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore'

// ==========================================
// TABASAMU FURNITURE DESIGNERS
// CONFIGURATION
// ==========================================

// Verify this WhatsApp number before launching.
const WHATSAPP_NUMBER = '255622069561'

// ==========================================
// TEMPORARY SAMPLE PRODUCTS
// Used when Firestore has no accessible products.
// ==========================================

const sampleProducts = [
  {
    id: 'sample-1',
    name: 'Modern Luxury Bed',
    category: 'Bedroom',
    image:
      'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80',
    active: true,
  },
  {
    id: 'sample-2',
    name: 'Elegant Wooden Wardrobe',
    category: 'Storage',
    image:
      'https://images.unsplash.com/photo-1595428774223-ef52624120d2?auto=format&fit=crop&w=800&q=80',
    active: true,
  },
  {
    id: 'sample-3',
    name: 'Contemporary Dining Set',
    category: 'Dining',
    image:
      'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=800&q=80',
    active: true,
  },
  {
    id: 'sample-4',
    name: 'Premium Living Room',
    category: 'Living room',
    image:
      'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=800&q=80',
    active: true,
  },
]

// ==========================================
// APPLICATION DATA
// ==========================================

let products = [...sampleProducts]

const selectedDesigns = new Set()

const app = document.querySelector('#app')

// ==========================================
// WEBSITE STRUCTURE
// ==========================================

app.innerHTML = `
  <header class="navbar">

    <a class="brand" href="#" aria-label="Tabasamu home">
      <img
        class="brand-logo"
        src="/tabasamu-logo.png"
        alt="Tabasamu Furniture Designers"
      />
    </a>

    <a class="nav-contact" href="#contact">
      Contact us
    </a>

  </header>

  <main>

    <!-- HERO SECTION -->

    <section class="hero">

      <div class="hero-copy">

        <span class="eyebrow">CRAFTED WITH PASSION</span>

        <h1>
          Furniture that makes your house
          <em>a home.</em>
        </h1>

        <p>
          Discover beautiful furniture designs made with care.
          Find your favourite style and let us bring it to life.
        </p>

        <a class="primary-button" href="#collections">
          Explore our designs ↗
        </a>

      </div>

      <div class="hero-image">

        <img
          src="https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85"
          alt="Elegant modern living room furniture"
        />

        <div class="image-label">
          <span>TIMELESS DESIGN</span>
          <strong>Made for your lifestyle.</strong>
        </div>

      </div>

    </section>

    <!-- FURNITURE COLLECTION -->

    <section class="collections" id="collections">

      <div class="section-heading">

        <div>
          <span class="eyebrow">OUR COLLECTION</span>

          <h2>Find your inspiration</h2>

          <p>
            Choose the designs you would love in your space.
          </p>
        </div>

        <button class="basket-button" id="view-basket">
          My designs
          <span id="basket-count">0</span>
        </button>

      </div>

      <!-- CATEGORY FILTERS -->

      <div class="category-list">

        <button class="category active" data-category="All">
          All designs
        </button>

        <button class="category" data-category="Bedroom">
          Bedroom
        </button>

        <button class="category" data-category="Storage">
          Wardrobes
        </button>

        <button class="category" data-category="Dining">
          Dining
        </button>

        <button class="category" data-category="Living room">
          Living room
        </button>

      </div>

      <!-- PRODUCTS -->

      <div class="product-grid" id="product-grid">
        <p>Loading furniture designs...</p>
      </div>

    </section>

    <!-- CONTACT SECTION -->

    <section class="contact-section" id="contact">

      <div>

        <span class="eyebrow">HAVE A DESIGN IN MIND?</span>

        <h2>Let's create something beautiful.</h2>

        <p>
          Select your favourite designs and send us an inquiry.
          Our team will help you get a quotation.
        </p>

      </div>

      <button class="primary-button" id="inquire">
        Request selected designs ↗
      </button>

    </section>

  </main>

  <!-- FOOTER -->

  <footer>

    <a class="brand footer-brand" href="#">
      <img
        class="brand-logo"
        src="/tabasamu-logo.png"
        alt="Tabasamu Furniture Designers"
      />
    </a>

    <p>
      Beautiful spaces begin with thoughtful design.
    </p>

    <a
      class="footer-whatsapp"
      href="https://wa.me/${WHATSAPP_NUMBER}"
      target="_blank"
      rel="noopener noreferrer"
    >
      WhatsApp us
    </a>

  </footer>

  <!-- NOTIFICATION MESSAGE -->

  <div
    class="toast"
    id="toast"
    role="status"
    aria-live="polite"
  ></div>
`

// ==========================================
// DOM ELEMENTS
// ==========================================

const grid = document.querySelector('#product-grid')
const toast = document.querySelector('#toast')
const basketCount = document.querySelector('#basket-count')
const basketButton = document.querySelector('#view-basket')

// ==========================================
// NOTIFICATION FUNCTION
// ==========================================

let toastTimer

function showToast(message) {
  toast.textContent = message

  toast.classList.add('visible')

  clearTimeout(toastTimer)

  toastTimer = setTimeout(() => {
    toast.classList.remove('visible')
  }, 3000)
}

// ==========================================
// LOAD PRODUCTS FROM FIRESTORE
// ==========================================

async function loadProducts() {
  try {
    console.log('Connecting to Firebase...')
    console.log('Firebase Project:', db.app.options.projectId)

    const productsQuery = query(
      collection(db, 'products'),
      where('active', '==', true)
    )

    const snapshot = await getDocs(productsQuery)

    if (snapshot.empty) {
      console.log('No active products found in Firestore.')
      products = [...sampleProducts]
    } else {
      products = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))

      console.log('Furniture products loaded:', products.length)
    }

  } catch (error) {
    console.error('Firestore loading error:', error)

    // Keep the website usable while Firebase is being configured.
    products = [...sampleProducts]

    console.warn('Using temporary sample products instead.')
  }

  renderProducts()
  updateBasket()
}

// ==========================================
// DISPLAY PRODUCTS
// ==========================================

function renderProducts(category = 'All') {
  const visibleProducts = products.filter((product) => {
    return category === 'All' || product.category === category
  })

  if (visibleProducts.length === 0) {
    grid.innerHTML = '<p>No furniture designs found in this category.</p>'
    return
  }

  grid.innerHTML = visibleProducts
    .map((product) => {
      const isSelected = selectedDesigns.has(product.id)

      return `
        <article class="product-card">

          <div class="product-image">

            <img
              src="${product.image || ''}"
              alt="${product.name || 'Furniture design'}"
              loading="lazy"
            />

            <span class="product-category">
              ${product.category || 'Furniture'}
            </span>

          </div>

          <div class="product-info">

            <h3>${product.name || 'Unnamed design'}</h3>

            <div class="product-action">

              <span class="quote-label">
                Price on request
              </span>

              <button
                class="select-button ${isSelected ? 'selected' : ''}"
                data-id="${product.id}"
                aria-pressed="${isSelected}"
              >
                ${isSelected ? '✓ Selected' : '+ Select'}
              </button>

            </div>

          </div>

        </article>
      `
    })
    .join('')
}

// ==========================================
// UPDATE SELECTED DESIGNS
// ==========================================

function updateBasket() {
  basketCount.textContent = selectedDesigns.size

  basketButton.classList.toggle(
    'has-items',
    selectedDesigns.size > 0
  )
}

// ==========================================
// SELECT / REMOVE PRODUCTS
// ==========================================

grid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-id]')

  if (!button) return

  const id = button.dataset.id

  if (selectedDesigns.has(id)) {
    selectedDesigns.delete(id)
    showToast('Design removed from your selection.')
  } else {
    selectedDesigns.add(id)
    showToast('Design added to your selection.')
  }

  const activeCategory =
    document.querySelector('.category.active')?.dataset.category || 'All'

  renderProducts(activeCategory)
  updateBasket()
})

// ==========================================
// CATEGORY FILTERING
// ==========================================

document
  .querySelector('.category-list')
  .addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]')

    if (!button) return

    document.querySelectorAll('.category').forEach((item) => {
      item.classList.toggle('active', item === button)
    })

    renderProducts(button.dataset.category)
  })

// ==========================================
// VIEW SELECTED DESIGNS
// ==========================================

basketButton.addEventListener('click', () => {
  if (selectedDesigns.size === 0) {
    showToast('Please select a furniture design first.')
    return
  }

  showToast(`${selectedDesigns.size} furniture design(s) selected.`)

  document
    .querySelector('#contact')
    .scrollIntoView({ behavior: 'smooth' })
})

// ==========================================
// SEND INQUIRY THROUGH WHATSAPP
// ==========================================

document
  .querySelector('#inquire')
  .addEventListener('click', () => {
    if (selectedDesigns.size === 0) {
      showToast('Please select at least one design first.')

      document
        .querySelector('#collections')
        .scrollIntoView({ behavior: 'smooth' })

      return
    }

    const selectedProducts = products.filter((product) =>
      selectedDesigns.has(product.id)
    )

    const productList = selectedProducts
      .map((product, index) => {
        return `${index + 1}. ${product.name} (${product.category})`
      })
      .join('\n')

    const message = `
Hello Tabasamu Furniture Designers!

I am interested in the following furniture designs:

${productList}

Please provide me with a quotation.

Thank you!
    `.trim()

    const whatsappURL =
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`

    showToast('Opening WhatsApp to send your inquiry...')

    window.open(
      whatsappURL,
      '_blank',
      'noopener,noreferrer'
    )
  })

// ==========================================
// INITIALIZE WEBSITE
// ==========================================

loadProducts()
