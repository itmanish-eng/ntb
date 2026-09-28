/**
 * NOWTBOOK — Booking Page Controller
 * Reads flight ID from URL, renders provider list + flight segments,
 * handles ticket type filtering, provider/segment accordions, currency.
 */

const FlightBooking = (() => {
  let currentFlight = null;
  let currentProviders = [];
  let activeTicketType = 'all';
  let currentTrip = 'roundtrip';

  const PROVIDERS = [
    { id: 'budgetair', name: 'BudgetAir', color: '#0ea5e9', rating: 4.6, reviews: 1483, badge: 'Recommended provider', features: [{ icon: 'check', text: '24/7 live chat and telephone support' }], multiplier: 1.00, isBest: true },
    { id: 'tripcom', name: 'Trip.com', color: '#2579ff', rating: 4.9, reviews: 2984, features: [{ icon: 'check', text: '24/7 live chat and telephone support' }, { icon: 'check', text: 'Change booking for a fee' }], multiplier: 1.15 },
    { id: 'booking', name: 'Booking.com', color: '#003580', rating: 4.7, reviews: 1571, features: [], multiplier: 1.16 },
    { id: 'gotogate', name: 'Gotogate', color: '#1e40af', rating: 4.7, reviews: 2552, features: [{ icon: 'check', text: '24/7 customer support' }, { icon: 'check', text: 'Upgrade to make booking changes' }], multiplier: 1.16 },
    { id: 'flightnetwork', name: 'Flightnetwork', color: '#0891b2', rating: 4.8, reviews: 3925, features: [{ icon: 'check', text: 'Pay with UPI (Unified Payments Interface)' }, { icon: 'check', text: 'Upgrade to make booking changes' }], multiplier: 1.18 },
    { id: 'makemytrip', name: 'MakeMyTrip', color: '#ef4444', rating: 4.8, reviews: 19330, features: [{ icon: 'check', text: '24/7 customer support' }, { icon: 'info', text: 'Additional discounts of up to 20% may be available using Nowtobook exclusive code' }, { icon: 'info', text: "Partner's Terms and Conditions applicable" }], multiplier: 1.20 },
    { id: 'goibibo', name: 'Goibibo', color: '#f97316', rating: 4.6, reviews: 28567, features: [{ icon: 'check', text: '24/7 customer support' }, { icon: 'info', text: 'Additional discounts of flat 10% off for domestic flights and up to 20% off for international flights using Nowtobook exclusive code' }, { icon: 'info', text: "Partner's Terms and Conditions applicable" }], multiplier: 1.24 },
    { id: 'yatra', name: 'Yatra.com', color: '#7c3aed', rating: 3.9, reviews: 4002, features: [{ icon: 'check', text: 'Pay by instalments available' }, { icon: 'info', text: 'Additional discounts of up to 10% for domestic flights and up to 5% for international flights using Nowtobook exclusive code' }, { icon: 'info', text: "Partner's Terms and Conditions applicable" }], multiplier: 1.36 },
    { id: 'airline', name: 'Airline Direct', color: '#dc2626', rating: 4.9, reviews: 668, isAirline: true, features: [{ icon: 'check', text: 'Upgrade to make booking changes' }], multiplier: 1.39 },
    { id: 'skyticket', name: 'skyticket', color: '#0284c7', rating: 4.5, reviews: 2989, features: [{ icon: 'check', text: 'Customer support in your language' }], multiplier: 1.41 },
    { id: 'cleartrip', name: 'Cleartrip', color: '#059669', rating: 4.8, reviews: 13350, features: [{ icon: 'check', text: '24/7 customer support' }, { icon: 'info', text: 'Additional discounts of up to 20% (for domestic flights) and up to 7% off (for international flights) may be available using Nowtobook exclusive code' }, { icon: 'info', text: "Partner's Terms and Conditions applicable" }], multiplier: 1.41 },
    { id: 'travomint', name: 'Travomint', color: '#9333ea', rating: 4.0, reviews: 563, features: [{ icon: 'check', text: '24/7 customer support' }], multiplier: 1.47 }
  ];

  // ============================================================
  // ✅ URL SE DATES NIKAALO
  // ============================================================
  function getSearchDepartureDate() {
    const params = new URLSearchParams(window.location.search);
    const depStr = params.get('departure') || '';
    if (!depStr) return 'Oct 12';
    const d = new Date(depStr);
    if (isNaN(d)) return depStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function getSearchReturnDate() {
    const params = new URLSearchParams(window.location.search);
    const retStr = params.get('return') || '';
    if (!retStr) return 'Oct 19';
    const d = new Date(retStr);
    if (isNaN(d)) return retStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  // ============================================================
  // INIT
  // ============================================================
  async function init() {
    const params = new URLSearchParams(window.location.search);
    const flightId = params.get('id');
    currentTrip = params.get('trip') || 'roundtrip';

    if (!flightId) {
      document.getElementById('providerList').innerHTML =
        '<div class="ntb-empty-state"><i class="bi bi-airplane" aria-hidden="true"></i><h3>No flight selected</h3><p>Please go back and pick a flight to continue.</p><a href="results.html" class="ntb-btn-primary">Back to results</a></div>';
      return;
    }

    const allFlights = await window.FlightDataService.getFlights();
    currentFlight = allFlights.find(f => f.id === flightId);

    if (!currentFlight) {
      document.getElementById('providerList').innerHTML =
        '<div class="ntb-empty-state"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><h3>Flight not found</h3><p>The selected flight is no longer available.</p><a href="results.html" class="ntb-btn-primary">Back to results</a></div>';
      return;
    }

    renderSummary(params);
    renderFlightSegments(currentFlight);
    buildProviders(currentFlight);
    renderProviders();
    attachProviderAccordions();
    attachSegmentAccordions();
    attachTicketTypeListeners();
    updateTicketTypePrices();

    window.addEventListener('ntb:currency-changed', () => {
      buildProviders(currentFlight);
      renderProviders();
      attachProviderAccordions();
      updateTicketTypePrices();
    });
  }

  function getActiveLegs(flight) {
    const legs = flight.legs || [];
    if (currentTrip === 'oneway') return legs.slice(0, 1);
    return legs;
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  function renderSummary(params) {
    const fromCity = params.get('from') || currentFlight.fromCity || 'New Delhi';
    const fromCode = params.get('fromCode') || currentFlight.fromCode || '';
    const toCity = params.get('to') || currentFlight.toCity || 'Dubai';
    const toCode = params.get('toCode') || currentFlight.toCode || '';
    const departure = params.get('departure') || '';
    const returnDate = params.get('return') || '';
    const trip = params.get('trip') || 'roundtrip';
    const adults = params.get('adults') || '1';
    const cabin = params.get('class') || 'Economy';

    const elFrom = document.getElementById('bookingFrom');
    const elTo = document.getElementById('bookingTo');
    const elMeta = document.getElementById('bookingMeta');

    if (elFrom) elFrom.textContent = `${fromCity}${fromCode ? ' (' + fromCode + ')' : ''}`;
    if (elTo) elTo.textContent = `${toCity}${toCode ? ' (' + toCode + ')' : ''}`;

    const isOneWay = trip === 'oneway';
    const dateStr = isOneWay ? departure : `${departure}${returnDate ? ' – ' + returnDate : ''}`;
    const tripLabel = isOneWay ? 'One way' : 'Return';

    if (elMeta) {
      elMeta.textContent = [tripLabel, dateStr, `${adults} Traveller${adults > 1 ? 's' : ''}`, cabin]
        .filter(Boolean).join(' · ');
    }

    const backLink = document.querySelector('.ntb-booking-back');
    if (backLink) {
      const backParams = new URLSearchParams(params);
      backParams.delete('id');
      backLink.href = `results.html?${backParams.toString()}`;
    }
  }

  // ============================================================
  // PROVIDERS
  // ============================================================
  function buildProviders(flight) {
    const base = flight.basePrice || 5000;
    const legs = getActiveLegs(flight);
    const airlineName = (legs[0] && legs[0].airline) || 'Airline';

    currentProviders = PROVIDERS.map(p => ({
      ...p,
      name: p.isAirline ? airlineName : p.name,
      price: Math.round(base * p.multiplier)
    }));
  }

  function renderProviders() {
    const list = document.getElementById('providerList');
    if (!list) return;

    if (!currentProviders.length) {
      list.innerHTML = '<div class="ntb-empty-state"><p>No providers available.</p></div>';
      return;
    }

    const fmt = (v) => window.FlightDataService.formatPrice(v);
    list.innerHTML = currentProviders.map((p, i) => renderProviderCard(p, i, fmt)).join('');
  }

  function renderProviderCard(p, index, fmt) {
    const featuresHtml = (p.features || []).map(f => {
      const icon = f.icon === 'info' ? 'bi-info-circle' : 'bi-check-circle-fill';
      return `<span><i class="bi ${icon}" aria-hidden="true"></i>${f.text}</span>`;
    }).join('');

    const ratingHtml = `
      <div class="ntb-provider-rating">
        <span class="ntb-star">★</span>
        <b>${p.rating}</b>
        <span>/5 · ${p.reviews.toLocaleString('en-IN')}</span>
      </div>
    `;

    const badgeHtml = p.badge ? `<span class="ntb-provider-badge"><i class="bi bi-info-circle" aria-hidden="true"></i>${p.badge}</span>` : '';

    const legs = getActiveLegs(currentFlight);
    const firstLeg = legs[0] || {};

    const logoInner = p.isAirline && window.getAirlineLogo
      ? `<img src="${getAirlineLogo(firstLeg.airlineCode)}" alt="${p.name}">`
      : `<span style="background:${p.color}; color:#fff; width:100%; height:100%; display:flex; align-items:center; justify-content:center; border-radius:6px; font-weight:800; font-size:16px;">${p.name.charAt(0).toUpperCase()}</span>`;

    const baggageHtml = legs.map((leg, li) => {
      const fromCode = leg.departureCode || '';
      const toCode = leg.arrivalCode || '';
      const label = currentTrip === 'oneway' ? 'One way' : (li === 0 ? 'Outbound' : 'Return');
      return `
        <div class="ntb-provider-baggage-group">
          <strong>${label}: ${fromCode} → ${toCode} · ${leg.cabin || 'Economy'}</strong>
          <div class="ntb-provider-baggage-item">
            <i class="bi bi-check-circle-fill" aria-hidden="true"></i>
            <span>1 cabin bag</span>
          </div>
          <div class="ntb-provider-baggage-item ${p.multiplier < 1.10 ? 'is-no' : ''}">
            <i class="bi ${p.multiplier < 1.10 ? 'bi-x-circle' : 'bi-check-circle-fill'}" aria-hidden="true"></i>
            <span>${p.multiplier < 1.10 ? 'Checked bag may cost extra' : '1 checked bag'}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <article class="ntb-resultcard-card ntb-provider-card ${p.isBest ? 'is-best' : ''}" data-provider-id="${p.id}">
        <div class="ntb-provider-head">
          <div class="ntb-provider-logo">${logoInner}</div>

          <div class="ntb-provider-info">
            <div class="ntb-provider-name-row">
              <strong>${p.name}</strong>
              ${badgeHtml}
            </div>
            ${ratingHtml}
            ${featuresHtml ? `<div class="ntb-provider-features">${featuresHtml}</div>` : ''}
          </div>

          <div class="ntb-provider-price">${fmt(p.price)}</div>

          <button type="button" class="ntb-btn-primary ntb-provider-btn" data-book-provider="${p.id}">
            Book
          </button>

          <button type="button" class="ntb-provider-toggle"
                  data-provider-toggle="${p.id}"
                  aria-expanded="false"
                  aria-controls="providerBody-${p.id}"
                  aria-label="Show baggage details">
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
        </div>

        <div class="ntb-provider-body" id="providerBody-${p.id}" hidden>
          <div class="ntb-provider-baggage">${baggageHtml}</div>
        </div>
      </article>
    `;
  }

  function attachProviderAccordions() {
    document.querySelectorAll('[data-provider-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.providerToggle;
        const body = document.getElementById('providerBody-' + id);
        if (!body) return;
        const isOpen = !body.hidden;
        body.hidden = isOpen;
        btn.setAttribute('aria-expanded', String(!isOpen));
        btn.setAttribute('aria-label', isOpen ? 'Show baggage details' : 'Hide baggage details');
      });
    });

    document.querySelectorAll('[data-book-provider]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.bookProvider;
        const prov = currentProviders.find(p => p.id === pid);
        if (!prov) return;
        const price = window.FlightDataService.formatPrice(prov.price);
        alert(`Booking with ${prov.name} for ${price}\n\n(Real booking flow not implemented in demo)`);
      });
    });
  }

  // ============================================================
  // ✅ FLIGHT SEGMENTS — URL se dates
  // ============================================================
  function renderFlightSegments(flight) {
    const container = document.getElementById('bookingSegments');
    if (!container) return;

    const legs = getActiveLegs(flight);
    if (!legs.length) {
      container.innerHTML = '<p class="text-muted">No flight details available.</p>';
      return;
    }

    const labels = currentTrip === 'oneway' ? ['Outbound'] : ['Outbound', 'Return'];

    container.innerHTML = legs.map((leg, i) =>
      renderSegment(leg, labels[i] || `Leg ${i + 1}`, i)
    ).join('');
  }

  function renderSegment(leg, label, index) {
    const fromCode = leg.departureCode || '';
    const toCode = leg.arrivalCode || '';

    // ✅ URL se date lo (agar available hai)
    const urlDate = index === 0 ? getSearchDepartureDate() : getSearchReturnDate();
    const dateLabel = urlDate || formatDateLabel(leg.departureDate);

    const stops = leg.stops || 0;

    let stopsText = 'Direct';
    if (stops > 0 && leg.layovers && leg.layovers.length) {
      const stopsLabel = stops === 1 ? '1 stop' : `${stops} stops`;
      const layoverText = leg.layovers.map(l => `${l.duration} in ${l.city} (${l.code})`).join(', ');
      stopsText = `${stopsLabel} • ${layoverText}`;
    } else if (stops > 0) {
      stopsText = stops === 1 ? '1 stop' : `${stops} stops`;
    }

    // URL se aayi date same day hai, toh offset 0
    const dayOffset = 0;
    const dayOffsetHtml = dayOffset > 0 ? `<sup class="ntb-segment-day">+${dayOffset}</sup>` : '';

    return `
      <div class="ntb-booking-segment">
        <button type="button" class="ntb-booking-segment-head"
                data-segment-toggle="${index}"
                aria-expanded="false"
                aria-controls="segmentBody-${index}">
          <div class="ntb-segment-head-left">
            <strong>${label}</strong>
            <span class="ntb-segment-dot" aria-hidden="true">•</span>
            <span>${dateLabel}</span>
          </div>
          <i class="bi bi-chevron-down ntb-segment-chevron" aria-hidden="true"></i>
        </button>

        <div class="ntb-segment-summary">
          <div class="ntb-segment-logo">
            <img src="${getAirlineLogo(leg.airlineCode)}" alt="${leg.airline}"
                 onerror="this.src='https://placehold.co/36x36/1e293b/38bdf8?text=${leg.airlineCode}'">
          </div>
          <div class="ntb-segment-info">
            <div class="ntb-segment-route">
              <b>${fromCode}</b>
              <i class="bi bi-arrow-right" aria-hidden="true"></i>
              <b>${toCode}</b>
            </div>
            <div class="ntb-segment-time">
              <span>${formatTime12(leg.departureTime)} – ${formatTime12(leg.arrivalTime)}</span>${dayOffsetHtml}
              <span class="ntb-segment-dur">(${leg.duration || ''})</span>
            </div>
            <div class="ntb-segment-stops">${stopsText}</div>
          </div>
        </div>

        <div class="ntb-booking-segment-body" id="segmentBody-${index}" hidden>
          <div class="ntb-segment-expanded">
            ${renderLegRows(leg)}
          </div>
        </div>
      </div>
    `;
  }

  function renderLegRows(leg) {
    const layovers = leg.layovers || [];

    if (!layovers.length) {
      return renderSingleLeg(leg, 0);
    }

    let html = '';
    html += renderSingleLeg(leg, 0, layovers[0] ? layovers[0].city : null);

    layovers.forEach((lay, i) => {
      html += `
        <div class="ntb-booking-layover">
          <i class="bi bi-clock-history" aria-hidden="true"></i>
          ${lay.duration} · Connect in ${lay.city} (${lay.code})
        </div>
      `;
      if (i === layovers.length - 1) {
        html += renderSingleLeg(leg, 1, null);
      }
    });

    return html;
  }

  function renderSingleLeg(leg, position, nextCity) {
    const fmt = (t) => formatTime12(t);
    const fromCode = leg.departureCode || '';
    const toCode = leg.arrivalCode || '';
    const fromCity = leg.departureCity || '';
    const toCity = leg.arrivalCity || '';

    const time = position === 0 ? leg.departureTime : leg.arrivalTime;
    const cityCode = position === 0 ? fromCode : toCode;
    const city = position === 0 ? fromCity : toCity;

    return `
      <div class="ntb-booking-leg">
        <div class="ntb-booking-leg-logo">
          <img src="${getAirlineLogo(leg.airlineCode)}" alt="${leg.airline}" onerror="this.src='https://placehold.co/36x36/1e293b/38bdf8?text=${leg.airlineCode}'">
        </div>
        <div class="ntb-booking-leg-body">
          <div class="ntb-booking-leg-airline">${leg.airline} ${leg.flightNumber || ''}</div>
          <div class="ntb-booking-leg-line">
            <span><i class="bi bi-clock" aria-hidden="true"></i>${fmt(time)}</span>
            <span>${city} ${cityCode ? `<b>${cityCode}</b>` : ''}</span>
          </div>
          <div class="ntb-booking-leg-line">
            <span><i class="bi bi-hourglass-split" aria-hidden="true"></i>${leg.duration || ''}</span>
            <span>${leg.aircraft || 'Aircraft'}</span>
          </div>
          <div class="ntb-booking-leg-meta">
            <span><i class="bi bi-wifi" aria-hidden="true"></i>Wi-Fi</span>
            <span><i class="bi bi-cup-hot" aria-hidden="true"></i>Meal</span>
            <span><i class="bi bi-lightning-charge" aria-hidden="true"></i>Power</span>
            <button type="button">Show info</button>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================================
  // SEGMENT ACCORDION
  // ============================================================
  function attachSegmentAccordions() {
    document.querySelectorAll('.ntb-booking-segment-head').forEach(head => {
      head.addEventListener('click', () => {
        const index = head.dataset.segmentToggle;
        const body = document.getElementById('segmentBody-' + index);
        if (!body) return;

        const isOpen = !body.hidden;
        body.hidden = isOpen;
        head.setAttribute('aria-expanded', String(!isOpen));
        head.classList.toggle('is-open', !isOpen);
      });
    });
  }

  // ============================================================
  // TICKET TYPE
  // ============================================================
  function attachTicketTypeListeners() {
    const types = document.querySelectorAll('.ntb-ticket-type');
    types.forEach(btn => {
      btn.addEventListener('click', () => {
        types.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        activeTicketType = btn.dataset.type;
        applyTicketTypeSort();
      });
    });
  }

  function applyTicketTypeSort() {
    if (!currentProviders.length) return;

    const sorted = [...currentProviders];
    if (activeTicketType === 'bag') {
      sorted.sort((a, b) => {
        const aBag = a.multiplier >= 1.10 ? 0 : 1;
        const bBag = b.multiplier >= 1.10 ? 0 : 1;
        if (aBag !== bBag) return aBag - bBag;
        return a.price - b.price;
      });
    } else if (activeTicketType === 'flex') {
      sorted.sort((a, b) => b.rating - a.rating || a.price - b.price);
    } else {
      sorted.sort((a, b) => a.price - b.price);
    }

    currentProviders = sorted;
    renderProviders();
    attachProviderAccordions();
  }

  function updateTicketTypePrices() {
    if (!currentProviders.length) return;
    const prices = currentProviders.map(p => p.price);
    const min = Math.min(...prices);
    const fmt = (v) => window.FlightDataService.formatPrice(v);

    const elAll = document.querySelector('[data-price-all]');
    const elBag = document.querySelector('[data-price-bag]');
    const elFlex = document.querySelector('[data-price-flex]');

    if (elAll) elAll.textContent = fmt(min);
    if (elBag) elBag.textContent = fmt(Math.round(min * 1.06));
    if (elFlex) elFlex.textContent = fmt(Math.round(min * 1.20));
  }

  // ============================================================
  // UTIL
  // ============================================================
  function formatTime12(time) {
    if (!time || time === '--:--') return '--:--';
    if (/am|pm/i.test(time)) return String(time).toUpperCase().trim();
    const parts = String(time).split(':');
    if (parts.length < 2) return time;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m)) return time;
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
  }

  function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    const cleaned = String(dateStr).replace(/^[A-Za-z]+,?\s+/, '');
    const d = new Date(`${cleaned}, ${new Date().getFullYear()}`);
    if (isNaN(d)) return dateStr;
    const day = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNum = d.getDate();
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${day}, ${dayNum} ${month}`;
  }

  function computeDayOffset(depStr, arrStr) {
    if (!depStr || !arrStr) return 0;
    const year = new Date().getFullYear();
    const dep = new Date(`${depStr}, ${year}`);
    const arr = new Date(`${arrStr}, ${year}`);
    if (isNaN(dep) || isNaN(arr)) return 0;
    const diffMs = arr.getTime() - dep.getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  return { init };
})();

window.FlightBooking = FlightBooking;