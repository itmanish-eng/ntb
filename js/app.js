/**
 * NOWTBOOK — Main App Script
 * Initializes global UI features: AOS animations, component loading,
 * FAQ accordions, trending tags, and responsive behaviors.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize AOS animation library if present
  if (typeof AOS !== 'undefined') {
    AOS.init({ once: true, offset: 60 });
  }

  // 2. Automatically load reusable Header, Search Forms, and Footer components
  if (window.ComponentLoader) {
    await window.ComponentLoader.loadAll();
  }

  // 3. Initialize Results Controller if on results page
  if (document.body.classList.contains('ntb-results-page') && window.FlightResults) {
    window.FlightResults.init();
  }

  // 3b. Initialize Booking Controller if on booking page
  if (document.body.classList.contains('ntb-booking-page') && window.FlightBooking) {
    window.FlightBooking.init();
  }

  // ============================================================
  // ✅ HOME PAGE — Currency Change Pe Prices Update
  // ============================================================
  function updateHomePrices() {
    if (!window.FlightDataService || !window.FlightDataService.formatPrice) return;
    const fmt = window.FlightDataService.formatPrice.bind(window.FlightDataService);

    // ✅ 1. Destination cards
    document.querySelectorAll('.ntb-dest-amount').forEach(el => {
      if (!el.dataset.inrPrice) {
        const inr = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
        el.dataset.inrPrice = inr;
      }
      const inr = parseFloat(el.dataset.inrPrice) || 0;
      if (inr) el.textContent = fmt(inr);
    });

    // ✅ 2. Popular routes — card ke andar price
    document.querySelectorAll('.ntb-route-from strong').forEach(el => {
      if (!el.dataset.inrPrice) {
        const inr = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
        el.dataset.inrPrice = inr;
      }
      const inr = parseFloat(el.dataset.inrPrice) || 0;
      if (inr) el.textContent = fmt(inr);
    });

    // ✅ 3. Mock flight cards (features section)
    document.querySelectorAll('.ntb-fc-price').forEach(el => {
      if (!el.dataset.inrPrice) {
        const inr = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
        el.dataset.inrPrice = inr;
      }
      const inr = parseFloat(el.dataset.inrPrice) || 0;
      if (inr) el.textContent = fmt(inr);
    });
  }

  // ✅ Page load pe call karo
  updateHomePrices();
  // ✅ Currency change pe call karo
  window.addEventListener('ntb:currency-changed', updateHomePrices);

  // 4. FAQ Accordion Toggle
  document.querySelectorAll('.ntb-faq-question').forEach(question => {
    question.addEventListener('click', () => {
      const item = question.closest('.ntb-faq-item');
      const answer = document.getElementById(question.getAttribute('aria-controls'));
      const isOpen = item.classList.toggle('open');
      question.setAttribute('aria-expanded', String(isOpen));
      if (answer) answer.hidden = !isOpen;
    });
  });

  // ============================================================
  // HELPER — Airport city/code se proper selection apply karo
  // ============================================================
  async function applyAirportToSearch(fieldSel, cityOrCode) {
    const searchPanel = document.querySelector('.ntb-search-panel');
    if (!searchPanel) return;
    const field = searchPanel.querySelector(fieldSel);
    if (!field) return;

    const input = field.querySelector('.ntb-airport-input');
    const picker = field.querySelector('.ntb-airport-picker');
    if (!input || !picker) return;

    let airports = [];
    try {
      airports = await window.FlightDataService.getAirports();
    } catch (e) {
      return;
    }

    const q = String(cityOrCode || '').trim();
    const ap = airports.find(a =>
      a.code.toUpperCase() === q.toUpperCase() ||
      a.city.toLowerCase() === q.toLowerCase()
    );
    if (!ap) return;

    input.value = ap.city;
    input.dataset.airportCode = ap.code;
    input.dataset.airportName = ap.name;
    picker.classList.add('has-selection');
    picker.classList.remove('is-editing', 'open');

    const codeEl = picker.querySelector('.ntb-airport-selected-code');
    const nameEl = picker.querySelector('.ntb-airport-selected-name');
    if (codeEl) codeEl.textContent = ap.code;
    if (nameEl) nameEl.textContent = ap.name;
  }

  // ============================================================
  // ✅ Airline Colors — fallback badge ke liye
  // ============================================================
  function getAirlineColor(code) {
    const colors = {
      "EK": "#d71921", "EY": "#bd8b13", "QR": "#5c0632", "TG": "#5b2c8d",
      "SQ": "#f9a01b", "BA": "#075aaa", "LH": "#05164d", "AF": "#002157",
      "KL": "#00a1de", "6E": "#1c3f94", "AI": "#d71921", "UK": "#5b2c8d",
      "SG": "#e31837", "AA": "#0078d2", "DL": "#003366", "TK": "#c70a0c",
      "SV": "#006c35", "WY": "#c8a45c", "GF": "#c8a45c", "ET": "#6c8e3e",
      "FZ": "#ff6b00", "VS": "#e10a0a", "AK": "#ff0000", "MH": "#00529c",
      "CX": "#005d63", "QF": "#e40000", "IX": "#d71921", "QP": "#1c3f94"
    };
    return colors[code] || '#1e293b';
  }

  // 5. Trending Tags Quick Click on Homepage
  document.querySelectorAll('.ntb-trending-tag').forEach(tag => {
    tag.addEventListener('click', async (e) => {
      e.preventDefault();
      const text = tag.textContent.trim();
      const parts = text.split('→').map(s => s.trim());
      if (parts.length !== 2) return;

      await applyAirportToSearch('.ntb-field-from', parts[0]);
      await applyAirportToSearch('.ntb-field-to', parts[1]);

      document.querySelector('.ntb-search-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  // ============================================================
  // 5b. ✅ POPULAR ROUTES — Airline Logo Load Karo
  // Sabse zyada flights wali airline ka logo dikhao
  // Logo na ho toh airline code ka colored badge
  // ============================================================
  async function loadRouteAirlineLogos() {
    if (!window.FlightDataService || !window.FlightDataService.getFlights) return;
    if (!window.getAirlineLogo) return;

    let flights = [];
    try {
      flights = await window.FlightDataService.getFlights();
    } catch (e) {
      return;
    }

    // Har route ka airline count nikaalo
    const routeAirlineMap = {};

    flights.forEach(f => {
      const depLeg = f.legs && f.legs[0] ? f.legs[0] : f;
      const fromCode = (f.fromCode || (depLeg && depLeg.departureCode) || '').toUpperCase();
      const toCode = (f.toCode || (depLeg && depLeg.arrivalCode) || '').toUpperCase();
      const airlineCode = depLeg.airlineCode || '';

      if (!fromCode || !toCode || !airlineCode) return;

      const key = fromCode + '→' + toCode;
      if (!routeAirlineMap[key]) {
        routeAirlineMap[key] = {};
      }
      routeAirlineMap[key][airlineCode] = (routeAirlineMap[key][airlineCode] || 0) + 1;
    });

    // Har route ka top airline (sabse zyada flights wali)
    const routeTopAirline = {};
    Object.entries(routeAirlineMap).forEach(([key, airlines]) => {
      let topCode = '';
      let topCount = 0;
      Object.entries(airlines).forEach(([code, count]) => {
        if (count > topCount) {
          topCount = count;
          topCode = code;
        }
      });
      routeTopAirline[key] = topCode;
    });

    // Ab har card me logo ya fallback badge daalo
    document.querySelectorAll('.ntb-route-card').forEach(card => {
      const fromCodeEl = card.querySelector('.ntb-route-leg .ntb-route-code');
      const toCodeEl = card.querySelector('.ntb-route-leg-right .ntb-route-code');
      if (!fromCodeEl || !toCodeEl) return;

      const fromCode = fromCodeEl.textContent.trim().toUpperCase();
      const toCode = toCodeEl.textContent.trim().toUpperCase();
      const key = fromCode + '→' + toCode;

      const airlineCode = routeTopAirline[key];

      const logoBox = card.querySelector('.ntb-route-airline');
      if (!logoBox) return;

      if (!airlineCode) {
        // Kuch nahi — khaali chhodo
        return;
      }

      const logoUrl = window.getAirlineLogo(airlineCode);
      const fallbackColor = getAirlineColor(airlineCode);

      // ✅ Image + Fallback badge dono banao
      logoBox.innerHTML =
        '<img src="' + logoUrl + '" alt="' + airlineCode + '" ' +
        'style="width:100%;height:100%;object-fit:contain;" ' +
        'onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
        '<span class="ntb-route-airline-fallback" ' +
        'style="display:none;width:100%;height:100%;align-items:center;justify-content:center;' +
        'background:' + fallbackColor + ';color:#fff;font-size:12px;font-weight:800;' +
        'border-radius:6px;letter-spacing:0.02em;">' + airlineCode + '</span>';
    });
  }

  // ✅ Call karo
  loadRouteAirlineLogos();

  // ============================================================
  // 6. ✅ Popular Routes Card Click → Seedha Results Page
  // ============================================================
  document.querySelectorAll('.ntb-route-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      e.preventDefault();

      const fromCodeEl = card.querySelector('.ntb-route-leg .ntb-route-code');
      const toCodeEl = card.querySelector('.ntb-route-leg-right .ntb-route-code');
      const fromCityEl = card.querySelector('.ntb-route-leg .ntb-route-city');
      const toCityEl = card.querySelector('.ntb-route-leg-right .ntb-route-city');

      if (!fromCodeEl || !toCodeEl) return;

      const fromCode = fromCodeEl.textContent.trim();
      const toCode = toCodeEl.textContent.trim();
      const fromCity = fromCityEl ? fromCityEl.textContent.trim() : fromCode;
      const toCity = toCityEl ? toCityEl.textContent.trim() : toCode;

      // Search form se dates aur trip type lo
      const searchPanel = document.querySelector('.ntb-search-panel');
      const depInput = searchPanel?.querySelector('[data-date-type="departure"] .ntb-date-input');
      const retInput = searchPanel?.querySelector('[data-date-type="return"] .ntb-date-input');
      const tripTab = searchPanel?.querySelector('.ntb-trip-tab.active');
      const isOneWay = tripTab?.dataset.tab === 'oneway';

      let departure = depInput?.value || '';
      let returnDate = isOneWay ? '' : (retInput?.value || '');

      if (!departure) {
        const today = new Date();
        departure = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }
      if (!isOneWay && !returnDate) {
        const ret = new Date();
        ret.setDate(ret.getDate() + 7);
        returnDate = ret.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }

      const params = new URLSearchParams({
        from: fromCity,
        fromCode: fromCode,
        to: toCity,
        toCode: toCode,
        departure: departure,
        return: isOneWay ? '' : returnDate,
        trip: isOneWay ? 'oneway' : 'roundtrip',
        adults: '1',
        class: 'Economy'
      });

      window.location.href = 'results.html?' + params.toString();
    });
  });
});