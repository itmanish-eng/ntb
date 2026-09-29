/**
 * NOWTBOOK — Component Loader & Manager
 * Provides reusable component injection and management:
 * 1. Header (components/header.html)
 * 2. Search Form (components/search-form.html)
 * 3. Footer (components/footer.html)
 * 4. Airline Logo Slider (components/airline-slider.html)
 */

const ComponentLoader = (() => {
  const airlines = [
    ['Air France', 'airfrance'],
    ['Air India', 'airindia'],
    ['Air India Express', 'airindiaexpress'],
    ['Akasa Air', 'akasaair'],
    ['American Airlines', 'americanairline'],
    ['British Airways', 'britishairways'],
    ['Delta', 'delta'],
    ['Emirates', 'emirates'],
    ['Ethiopian Airlines', 'ethiopianairlines'],
    ['Etihad Airways', 'etihadairways'],
    ['Finnair', 'finnair'],
    ['flydubai', 'flydubai'],
    ['flynas', 'flynas'],
    ['Gulf Air', 'gulfair'],
    ['IndiGo', 'indigo'],
    ['ITA Airways', 'itaairways'],
    ['Japan Airlines', 'japanairlines'],
    ['KLM', 'klm'],
    ['LOT Polish Airlines', 'lot'],
    ['Lufthansa', 'lufthansa'],
    ['Oman Air', 'omanair'],
    ['Qatar Airways', 'qatarairways'],
    ['Saudia', 'saudia'],
    ['SpiceJet', 'spicejet'],
    ['SWISS', 'swiss'],
    ['Thai Airways', 'thai'],
    ['Turkish Airlines', 'turkishairlines'],
    ['Virgin Atlantic', 'virginatlantic'],
    ['Vistara', 'vistara']
  ];

  const templates = {
    'airline-slider': '<div class="ntb-airlines-slider" role="region" aria-label="Airline logos" tabindex="0"></div>',
    header: `
      <nav class="ntb-navbar" id="mainNav">
        <div class="container">
          <div class="ntb-nav-inner">
            <a href="index.html" class="ntb-brand">
              <img
                src="assest/logo/Nowtobook_logo_white.svg"
                data-default-logo="assest/logo/Nowtobook_logo_white.svg"
                data-scrolled-logo="assest/logo/nowtobook_logo.svg"
                alt="Nowtobook"
                class="ntb-logo"
              />
            </a>

            <div class="ntb-nav-actions">
              <a href="contact.html" class="ntb-nav-help"><i class="bi bi-question-circle me-1" aria-hidden="true"></i><span class="ntb-nav-help-text">Help</span></a>
              <div class="ntb-currency-wrap">
                <button class="ntb-currency-trigger" id="currencyTrigger" type="button" aria-expanded="false" aria-controls="currencyMenu">
                  <i class="bi bi-globe2 me-1" aria-hidden="true"></i><span id="selectedCurrency">INR</span><i class="bi bi-chevron-down ms-1" aria-hidden="true"></i>
                </button>
                <div class="ntb-currency-menu" id="currencyMenu">
                  <div class="ntb-currency-heading">Display prices in</div>
                  <button class="ntb-currency-option active" type="button" data-currency="INR">
                    <span><strong>₹</strong> Indian Rupee</span><small>INR</small>
                  </button>
                  <button class="ntb-currency-option" type="button" data-currency="USD">
                    <span><strong>$</strong> US Dollar</span><small>USD</small>
                  </button>
                  <button class="ntb-currency-option" type="button" data-currency="EUR">
                    <span><strong>€</strong> Euro</span><small>EUR</small>
                  </button>
                  <button class="ntb-currency-option" type="button" data-currency="GBP">
                    <span><strong>£</strong> British Pound</span><small>GBP</small>
                  </button>
                  <button class="ntb-currency-option" type="button" data-currency="AED">
                    <span><strong>د.إ</strong> UAE Dirham</span><small>AED</small>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    `,

    'search-form': `
      <div class="ntb-search-panel">
        <div class="ntb-trip-tabs">
          <button class="ntb-trip-tab active" data-tab="roundtrip" type="button">
            <i class="bi bi-arrow-left-right me-1" aria-hidden="true"></i> Round Trip
          </button>
          <button class="ntb-trip-tab" data-tab="oneway" type="button">
            <i class="bi bi-arrow-right me-1" aria-hidden="true"></i> One Way
          </button>
        </div>

        <div class="ntb-search-form">
          <div class="ntb-search-row">
            <div class="ntb-field ntb-field-from">
              <div class="ntb-field-content ntb-airport-picker">
                <label class="ntb-field-label">From</label>
                <input type="text" class="ntb-field-input ntb-airport-input" placeholder="City or airport" value="New Delhi" autocomplete="off" aria-label="From city or airport" />
                <div class="ntb-airport-selected" aria-live="polite">
                  <span class="ntb-airport-selected-code">DEL</span>
                  <span class="ntb-airport-selected-name">Indira Gandhi International Airport</span>
                </div>
                <div class="ntb-airport-dropdown"></div>
              </div>
              <span class="ntb-field-error" role="alert"></span>
            </div>

            <button class="ntb-swap-btn" type="button" title="Swap airports" aria-label="Swap departure and destination airports">
              <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
            </button>

            <div class="ntb-field ntb-field-to">
              <div class="ntb-field-content ntb-airport-picker">
                <label class="ntb-field-label">To</label>
                <input type="text" class="ntb-field-input ntb-airport-input" placeholder="City or airport" value="Dubai" autocomplete="off" aria-label="To city or airport" />
                <div class="ntb-airport-selected" aria-live="polite">
                  <span class="ntb-airport-selected-code">DXB</span>
                  <span class="ntb-airport-selected-name">Dubai International Airport</span>
                </div>
                <div class="ntb-airport-dropdown"></div>
              </div>
              <span class="ntb-field-error" role="alert"></span>
            </div>

            <div class="ntb-field ntb-date-picker" data-date-type="departure">
              <div class="ntb-field-content">
                <label class="ntb-field-label">Departure</label>
                <input type="text" class="ntb-field-input ntb-date-input" placeholder="Select date" readonly aria-label="Departure date" />
              </div>
              <span class="ntb-field-error" role="alert"></span>
            </div>

            <div class="ntb-field ntb-return-field ntb-date-picker" data-date-type="return">
              <div class="ntb-field-content">
                <label class="ntb-field-label">Return</label>
                <input type="text" class="ntb-field-input ntb-date-input" placeholder="Select date" readonly aria-label="Return date" />
              </div>
              <span class="ntb-field-error" role="alert"></span>
            </div>

            <div class="ntb-field ntb-pax-field ntb-pax-picker">
              <div class="ntb-field-content">
                <label class="ntb-field-label">Travellers & Class</label>
                <div class="ntb-pax-display" role="button" tabindex="0" aria-label="Select travellers and travel class">1 Adult · Economy</div>
              </div>
              <div class="ntb-pax-menu">
                <div class="ntb-pax-row">
                  <div><strong>Adult</strong><small>12+ years</small></div>
                  <div class="ntb-pax-counter">
                    <button type="button" data-pax-action="decrease" data-pax-type="adult" aria-label="Decrease adult count">−</button>
                    <b data-pax-count="adult">1</b>
                    <button type="button" data-pax-action="increase" data-pax-type="adult" aria-label="Increase adult count">+</button>
                  </div>
                </div>
                <div class="ntb-pax-row">
                  <div><strong>Children</strong><small>2–12 years</small></div>
                  <div class="ntb-pax-counter">
                    <button type="button" data-pax-action="decrease" data-pax-type="children" aria-label="Decrease children count">−</button>
                    <b data-pax-count="children">0</b>
                    <button type="button" data-pax-action="increase" data-pax-type="children" aria-label="Increase children count">+</button>
                  </div>
                </div>
                <div class="ntb-pax-row">
                  <div><strong>Infant</strong><small>Below 2 years</small></div>
                  <div class="ntb-pax-counter">
                    <button type="button" data-pax-action="decrease" data-pax-type="infant" aria-label="Decrease infant count">−</button>
                    <b data-pax-count="infant">0</b>
                    <button type="button" data-pax-action="increase" data-pax-type="infant" aria-label="Increase infant count">+</button>
                  </div>
                </div>
                <div class="ntb-pax-class-title">Select travel class</div>
                <div class="ntb-pax-classes">
                  <button type="button" class="active" data-class="Economy">Economy</button>
                  <button type="button" data-class="Premium Economy">Premium Economy</button>
                  <button type="button" data-class="First Class">First Class</button>
                  <button type="button" data-class="Business">Business</button>
                </div>
              </div>
            </div>
          </div>

          <div class="ntb-calendar-menu" aria-label="Choose travel dates"></div>

          <div class="ntb-search-btn-wrap">
            <button class="ntb-search-btn" type="button">
              Search
            </button>
          </div>
        </div>
      </div>
    `,

    footer: `
      <footer class="ntb-footer ntb-footer-centered">
        <div class="container">
          <div class="ntb-footer-centered-main">
            <a class="ntb-footer-brand" href="index.html" aria-label="Nowtobook home">
              <img src="assest/logo/Nowtobook_logo_white.svg" alt="Nowtobook" class="ntb-footer-logo" />
            </a>
            <p class="ntb-body ntb-footer-tagline">
              At Nowtobook, we take the stress out of travel planning and make it easy for you to create unforgettable memories.
              Compare flights, explore travel guides, and plan your next journey with confidence.
            </p>
            <nav class="ntb-footer-nav" aria-label="Footer navigation">
              <a href="about.html">About Us</a>
              <a href="categories.html">Categories</a>
              <a href="contact.html">Contact Us</a>
              <a href="privacy.html">Privacy Policy</a>
              <a href="terms.html">Terms</a>
              <a href="sitemap.html">Sitemap</a>
            </nav>
          </div>
          <div class="ntb-footer-bottom">
            <p class="ntb-caption ntb-footer-copyright mb-0">
              © 2026 Nowtobook. All rights reserved. We are a comparison service — bookings complete on partner sites.
            </p>
          </div>
        </div>
      </footer>
    `
  };

  async function load(name, target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;

    let html = '';
    try {
      const res = await fetch(`components/${name}.html`);
      if (res.ok) {
        html = await res.text();
      } else {
        html = templates[name] || '';
      }
    } catch (e) {
      html = templates[name] || '';
    }

    el.innerHTML = html;

    if (name === 'header') {
      initHeader(options);
    }

    if (name === 'airline-slider') {
      initAirlineSlider(el);
    }

    return el;
  }

  function initAirlineSlider(el) {
    const items = airlines.map(([name, logo]) => `
      <div class="ntb-airline">
        <img src="assest/airline/${logo}.svg" alt="" loading="lazy">
        <span>${name}</span>
      </div>
    `).join('');

    el.innerHTML = `
      <div class="ntb-airlines-track">
        <div class="ntb-airlines-group">${items}</div>
        <div class="ntb-airlines-group" aria-hidden="true">${items}</div>
      </div>
    `;
  }

  async function loadAll() {
    const isResultsPage = document.body.classList.contains('ntb-results-page');
    const isBookingPage = document.body.classList.contains('ntb-booking-page');
    const forceScrolledHeader = isResultsPage || isBookingPage;

    const headerEl = document.getElementById('site-header') || document.querySelector('[data-component="header"]');
    if (headerEl) {
      await load('header', headerEl, { forceScrolled: forceScrolledHeader });
    } else {
      initHeader({ forceScrolled: forceScrolledHeader });
    }

    const homeSearchContainer = document.getElementById('flight-search-container');
    if (homeSearchContainer) {
      await load('search-form', homeSearchContainer);
      if (!isResultsPage && window.FlightSearchForm) {
        await window.FlightSearchForm.init(homeSearchContainer);
      }
    }

    const modifySearchContainer = document.getElementById('modify-search-container');
    if (modifySearchContainer) {
      const searchParams = new URLSearchParams(window.location.search);
      await load('search-form', modifySearchContainer);
      if (window.FlightSearchForm) {
        await window.FlightSearchForm.init(modifySearchContainer, {
          initialValues: {
            from: searchParams.get('from') || 'New Delhi',
            to: searchParams.get('to') || 'Dubai',
            departure: searchParams.get('departure') || '',
            return: searchParams.get('return') || ''
          },
          onSearch: (newParams) => {
            window.location.search = newParams.toString();
          }
        });
      }
    }

    await Promise.all(Array.from(
      document.querySelectorAll('[data-component="airline-slider"]'),
      target => load('airline-slider', target)
    ));

    const footerEl = document.getElementById('site-footer') || document.querySelector('[data-component="footer"]');
    if (footerEl) {
      await load('footer', footerEl);
    }
  }

  function initHeader(options = {}) {
    const nav = document.getElementById('mainNav');
    if (!nav) return;

    const navLogo = nav.querySelector('.ntb-logo');
    const currencyWrap = nav.querySelector('.ntb-currency-wrap');
    const currencyTrigger = nav.querySelector('#currencyTrigger');
    const currencyMenu = nav.querySelector('#currencyMenu');
    const selectedCurrency = nav.querySelector('#selectedCurrency');

    if (options.forceScrolled) {
      nav.classList.add('scrolled');
      if (navLogo && navLogo.dataset.scrolledLogo) {
        navLogo.src = navLogo.dataset.scrolledLogo;
      }
    } else {
      const updateNavbar = () => {
        const isScrolled = window.scrollY > 60;
        nav.classList.toggle('scrolled', isScrolled);
        if (navLogo) {
          navLogo.src = isScrolled
            ? navLogo.dataset.scrolledLogo
            : navLogo.dataset.defaultLogo;
        }
      };
      window.addEventListener('scroll', updateNavbar, { passive: true });
      updateNavbar();
    }

    if (currencyTrigger && currencyMenu) {
      const current = window.FlightDataService ? window.FlightDataService.getCurrency() : 'INR';
      if (selectedCurrency) selectedCurrency.textContent = current;

      currencyMenu.querySelectorAll('.ntb-currency-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.currency === current);
        opt.addEventListener('click', () => {
          const newCurr = opt.dataset.currency;
          currencyMenu.querySelectorAll('.ntb-currency-option').forEach(i => i.classList.remove('active'));
          opt.classList.add('active');
          if (selectedCurrency) selectedCurrency.textContent = newCurr;
          currencyWrap.classList.remove('open');
          currencyTrigger.setAttribute('aria-expanded', 'false');

          if (window.FlightDataService) {
            window.FlightDataService.setCurrency(newCurr);
          }
        });
      });

      currencyTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = currencyWrap.classList.toggle('open');
        currencyTrigger.setAttribute('aria-expanded', String(isOpen));
      });

      document.addEventListener('click', () => {
        currencyWrap?.classList.remove('open');
        currencyTrigger?.setAttribute('aria-expanded', 'false');
      });
    }
  }

  return {
    load,
    loadAll,
    initHeader,
    templates
  };
})();

window.ComponentLoader = ComponentLoader;