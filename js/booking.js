/**
 * NOWTBOOK — Booking page controller
 *
 * This is a normal PAGE (booking.html), not a drawer. Only the "Flight Details"
 * button inside the Flight Summary card opens an overlay: a right-side drawer
 * showing the full segment list.
 *
 * Data flow (nothing is invented):
 *   results.html "Select"
 *     -> booking.html?id=<OfferCode>&searchGuid=<guid>&trip=…&adults=…&class=…
 *     -> window.FlightDataService.getFlights()   (live SiteCity AeroSearch)
 *     -> window.FlightDataService.getPrebook()   (live SiteCity AeroPrebook)
 *     -> window.FlightDataService.bookFlight()   (live SiteCity AeroBook)
 *
 * Fares and add-ons are the provider's own amounts, and the add-on list is
 * whatever AeroPrebook returned for this offer.
 */

const FlightBooking = (() => {
  // ---- state -----------------------------------------------------------
  let params = new URLSearchParams(window.location.search);
  let flight = null;
  let searchGuid = '';
  let trip = 'roundtrip';
  let prebook = null;
  /** Selected add-ons: { id, kind, label, price, type, rph } */
  let selections = [];
  let travellers = [];
  let isSubmitting = false;

  // ---- cached page elements -------------------------------------------
  const $ = (id) => document.getElementById(id);
  let formEl = null;
  let drawerEl = null;
  let drawerPanel = null;
  let drawerBody = null;
  let statusEl = null;
  let confirmBtn = null;
  let lastFocused = null;

  /**
   * Meal preference / special assistance are booking REQUESTS.
   * SiteCity's ServiceInfoType has no `Meal` member, so these cannot be sent to
   * AeroBook; they are reported back in `ignoredSelections` rather than being
   * dropped silently.
   */
  const MEAL_OPTIONS = ['No meal', 'Vegetarian', 'Non-vegetarian', 'Jain', 'Halal', 'Kosher'];
  const ASSISTANCE_OPTIONS = [
    'No assistance needed',
    'Wheelchair to gate',
    'Wheelchair to seat',
    'Vision assistance',
    'Hearing assistance',
    'Priority boarding'
  ];

  /** Human labels for the provider's ServiceInfo types. */
  const TYPE_LABELS = {
    Insurance: 'Travel insurance',
    EmdSeat: 'Seat selection',
    Baggage: 'Extra checked bag',
    EmdBaggage: 'Extra checked bag',
    CabinBaggage: 'Extra carry-on bag',
    CheckIn: 'Check-in service',
    SMS: 'SMS notifications',
    EMD: 'Optional service'
  };

  // ---- helpers ---------------------------------------------------------
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const fmt = (v) => window.FlightDataService.formatPrice(v);

  function labelForType(type) {
    return TYPE_LABELS[type] || String(type || 'Optional service').replace(/([a-z])([A-Z])/g, '$1 $2');
  }

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

  /** "31.10.2026" or "31.10.2026 08:50" or ISO -> Date, or null. */
  function parseSiteCityDate(value) {
    const raw = String(value || '');
    const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // The API also emits ISO dates (e.g. leg.arrivalDate = "2026-11-12").
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** "31.10.2026" -> "Sat, 31 Oct" */
  function formatDateHuman(ddmmyyyy) {
    const d = parseSiteCityDate(ddmmyyyy);
    if (!d) return ddmmyyyy || '';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /**
   * "31.10.2026" -> "Sat, 18 Apr" (weekday + day + short month).
   * Accepts a full "DD.MM.YYYY HH:MM" stamp too.
   */
  function formatWeekdayShort(value) {
    const d = parseSiteCityDate(value);
    if (!d) return '';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /** "31.10.2026" -> "24 Jul 2026" (no weekday), as the drawer heading uses. */
  function formatDateFull(value) {
    const d = parseSiteCityDate(value);
    if (!d) return value || '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Segment "DD.MM.YYYY HH:MM" -> "HH:MM" (+1 if it lands the next day). */
  function segmentTimes(seg, prevSeg) {
    const dep = seg.Departure || {};
    const arr = seg.Arrival || {};
    const depTime = String(dep.Date || '').split(' ')[1] || '';
    const arrTime = String(arr.Date || '').split(' ')[1] || '';
    const depDay = String(dep.Date || '').split(' ')[0];
    const arrDay = String(arr.Date || '').split(' ')[0];
    return { depTime, arrTime, dayOffset: depDay && arrDay && depDay !== arrDay ? ' +1' : '' };
  }

  function minutesBetween(fromSeg, toSeg) {
    const parse = (seg, key) => {
      const raw = String((seg[key] || {}).Date || '');
      const m = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
      if (!m) return null;
      return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
    };
    const a = parse(fromSeg, 'Arrival');
    const b = parse(toSeg, 'Departure');
    if (a == null || b == null) return 0;
    const diff = Math.round((b - a) / 60000);
    return diff > 0 ? diff : 0;
  }

  function formatDuration(minutes) {
    const total = Number(minutes);
    if (!Number.isFinite(total) || total <= 0) return '—';
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h <= 0) return `${m}m`;
    if (m <= 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function setStatus(message, kind) {
    if (!statusEl) return;
    statusEl.className = 'ntb-confirm-msg' + (kind ? ` is-${kind}` : '');
    statusEl.innerHTML = message || '';
  }

  const isRoundTrip = () => trip !== 'oneway' && (flight.legs || []).length > 1;

  // ======================================================================
  // INIT — page bootstrap
  // ======================================================================
  async function init() {
    params = new URLSearchParams(window.location.search);
    formEl = $('bookingForm');
    statusEl = $('bookStatus');
    confirmBtn = $('confirmBookBtn');

    const offerCode = params.get('id');
    searchGuid = params.get('searchGuid') || '';
    trip = params.get('trip') || 'roundtrip';

    setupBackLink();
    setupStaticControls();

    if (!offerCode) {
      return fail('No flight selected', 'Please go back to the results page and pick a flight to continue.');
    }
    if (!searchGuid) {
      return fail(
        'This selection is incomplete',
        'The search reference is missing, so fares cannot be loaded. Please search again and select the flight from the results page.'
      );
    }

    // 1. The selected offer (the search is re-run from the URL context).
    try {
      const allFlights = await window.FlightDataService.getFlights();
      flight = allFlights.find((f) => f.id === offerCode) || null;
    } catch (error) {
      return fail('We couldn’t load this trip', error.message);
    }

    if (!flight) {
      return fail(
        'This fare is no longer available',
        'The selected flight was not in the latest search results. Please go back and choose again.'
      );
    }

    // 2. Fares + add-ons.
    try {
      prebook = await window.FlightDataService.getPrebook(flight.id, searchGuid);
    } catch (error) {
      return fail('We couldn’t load fares for this trip', error.message);
    }

    renderFlightSummary();
    renderAddons();
    renderTravellers();
    renderOrderSummary();
    setupFlightDrawer();
    setupSeatDrawer();

    formEl.hidden = false;
    $('bookingLoading').hidden = true;

    formEl.addEventListener('submit', handleSubmit);
    formEl.addEventListener('input', handleFormInput);
    formEl.addEventListener('change', handleFormInput);
    formEl.addEventListener('click', handleFormClick);

    window.addEventListener('ntb:currency-changed', renderOrderSummary);

    console.log(
      `[booking] page ready: ${flight.legs.length} leg(s), ` +
        `${prebook.tariffs.length} tariff(s), ${prebook.services.length} service(s), ` +
        `${prebook.emd.length} seat/bag option(s)`
    );
  }

  function fail(title, message) {
    const loading = $('bookingLoading');
    if (loading) loading.hidden = true;
    if (formEl) formEl.hidden = true;
    $('bookingErrorTitle').textContent = title;
    $('bookingErrorText').textContent = message;
    $('bookingError').hidden = false;
    console.error('[booking]', title, '-', message);
  }

  function setupBackLink() {
    const back = $('bookingBack');
    if (!back) return;
    const backParams = new URLSearchParams(params);
    backParams.delete('id');
    backParams.delete('searchGuid');
    back.addEventListener('click', () => {
      const qs = backParams.toString();
      window.location.href = qs ? `results.html?${qs}` : 'results.html';
    });
  }

  /** Card expiry month/year options (plain form scaffolding). */
  function setupStaticControls() {
    const monthSelect = $('cardExpiryMonth');
    if (monthSelect) {
      monthSelect.innerHTML = '<option value="">Select Month</option>';
      for (let m = 1; m <= 12; m += 1) {
        const opt = document.createElement('option');
        const val = String(m).padStart(2, '0');
        opt.value = val;
        opt.textContent = val;
        monthSelect.appendChild(opt);
      }
    }
    const yearSelect = $('cardExpiryYear');
    if (yearSelect) {
      yearSelect.innerHTML = '<option value="">Select Year</option>';
      const startYear = new Date().getFullYear();
      for (let y = startYear; y <= startYear + 15; y += 1) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        yearSelect.appendChild(opt);
      }
    }
  }

  // ======================================================================
  // 1. FLIGHT SUMMARY CARD
  // ======================================================================
  function renderFlightSummary() {
    const legs = flight.legs || [];
    const isRound = isRoundTrip();
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];

    // Airline names across the whole trip, e.g. "Thai Airways, Qatar Airways".
    const names = [];
    legs.forEach((leg) => {
      if (leg.airline && !names.includes(leg.airline)) names.push(leg.airline);
    });
    $('fsAirline').textContent = names.join(', ') || '—';

    $('fsTripMeta').textContent =
      `${isRound ? 'Round Trip' : 'One Way'} · ${flight.cabin || 'Economy'}`;

    // Departure / Return rows, each with its own airline logo.
    const labels = isRound ? ['Departure', 'Return'] : ['Departure'];
    $('fsLegs').innerHTML = legs
      .map((leg, i) => renderSummaryLeg(leg, labels[i] || `Leg ${i + 1}`, firstLeg))
      .join('');

    // Baggage strip from the provider's own per-segment allowance.
    $('baggageRow').innerHTML = renderBaggage(legs);

    const title = document.querySelector('.ntb-booking-title');
    if (title && firstLeg && lastLeg) {
      title.textContent = `Review your trip · ${firstLeg.departureCode} → ${lastLeg.arrivalCode}`;
    }
  }

  /**
   * One Departure / Return row, laid out like the reference:
   *   [logo]  Label        BOM 8:30AM  ->  DXB 3:10PM +1
   *           Date         1 Stop · 6h 40m · Operated by X
   *
   * @param {object} leg      the leg to render
   * @param {string} label    "Departure" / "Return"
   * @param {object} firstLeg used as a fallback for the arrival city when the
   *                          provider omits it on the return leg
   */
  function renderSummaryLeg(leg, label, firstLeg) {
    // The operating carrier can differ from the marketing one (codeshare); show
    // it whenever the provider says so, since that is the airline actually flown.
    const operating = leg.isCodeshare && leg.operatingAirline ? leg.operatingAirline : '';

    const logo = window.getAirlineLogo ? window.getAirlineLogo(leg.airlineCode) : '';
    const fallback = escapeHtml(leg.airlineCode || '--');
    const logoBlock = logo
      ? `<img src="${logo}" alt="${escapeHtml(leg.airline || '')}"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <span class="ntb-fs-logo-fallback" style="display:none">${fallback}</span>`
      : `<span class="ntb-fs-logo-fallback" style="display:flex">${fallback}</span>`;

    // The return leg's arrival is the trip origin; fall back to it when the
    // provider leaves arrivalCity blank.
    const arrCity = leg.arrivalCity || (firstLeg && firstLeg.departureCity) || '';
    const arrTitle = [leg.arrivalCode, arrCity].filter(Boolean).join(', ');
    const depTitle = [leg.departureCode, leg.departureCity].filter(Boolean).join(', ');

    // "+1" badge when the arrival lands on the following day.
    const dayOffset = leg.arrivalDate && leg.departureDate && leg.arrivalDate !== leg.departureDate
      ? '<sup class="ntb-fs-plus">+1</sup>'
      : '';

    return `
      <div class="ntb-fs-leg">
        <div class="ntb-fs-leg-logo">${logoBlock}</div>

        <div class="ntb-fs-leg-label">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(formatDateHuman(leg.departureDate))}</small>
        </div>

        <div class="ntb-fs-leg-main">
          <div class="ntb-fs-leg-route">
            <span class="ntb-fs-code" title="${escapeHtml(depTitle)}">${escapeHtml(leg.departureCode)}</span>
            <b class="ntb-fs-time">${escapeHtml(formatTime12(leg.departureTime))}</b>
            <i class="bi bi-arrow-right ntb-fs-arrow" aria-hidden="true"></i>
            <span class="ntb-fs-code" title="${escapeHtml(arrTitle)}">${escapeHtml(leg.arrivalCode)}</span>
            <b class="ntb-fs-time">${escapeHtml(formatTime12(leg.arrivalTime))}${dayOffset}</b>
          </div>

          <div class="ntb-fs-leg-meta">
            <span class="${leg.stops > 0 ? 'is-stops' : 'is-direct'}">${escapeHtml(leg.stopInfo || 'Non-stop')}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(leg.duration || '')}</span>
            ${operating ? `<span aria-hidden="true">·</span><span>Operated by ${escapeHtml(operating)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Baggage strip: personal item, carry-on and checked bag.
   *
   * The provider reports the allowance per segment as `Baggage` / `CabinBaggage`
   * with a `BaggageType` of "Kilos" or "Pieces", so the label reads
   * "Checked Bag (15 kg)" or "Carry-on Bag (1 Piece)".
   */
  function renderBaggage(legs) {
    // {"type":"Kilos","count":"15"} -> "15 kg" | {"type":"Pieces","count":"1"} -> "1 Piece"
    const describe = (bag) => {
      if (!bag || !bag.Count) return null;
      const count = String(bag.Count);
      const kind = String(bag.BaggageType || '').toLowerCase();
      if (kind.includes('kilo')) return { quantity: `${count} kg`, short: count };
      if (kind.includes('piece')) {
        return { quantity: `${count} Piece${count === '1' ? '' : 's'}`, short: count };
      }
      return { quantity: `${count} ${bag.BaggageType || 'item'}`.trim(), short: count };
    };

    // Use the first leg's allowance — that is what the reference card shows.
    const segments = [];
    legs.forEach((leg) => {
      (Array.isArray(leg.segments) ? leg.segments : []).forEach((seg) => segments.push(seg));
    });

    let cabin = null;
    let checked = null;
    segments.forEach((seg) => {
      if (!cabin) cabin = describe(seg.CabinBaggage);
      if (!checked) checked = describe(seg.Baggage);
    });

    const items = [
      {
        icon: 'bi-bag',
        label: 'Personal Item (Small bag)',
        value: 'Purse, small backpack, briefcase',
        ok: true
      },
      {
        icon: 'bi-bag-check',
        label: cabin ? `Carry-on Bag (${cabin.quantity})` : 'Carry-on Bag',
        value: cabin ? '' : 'Not included',
        ok: Boolean(cabin)
      },
      {
        icon: 'bi-suitcase2',
        label: checked ? `Checked bag (${checked.quantity})` : 'Checked bag not included',
        value: '',
        ok: Boolean(checked)
      }
    ];

    return items.map((it) => `
      <div class="ntb-fs-bag ${it.ok ? 'is-ok' : 'is-no'}">
        <i class="bi ${it.icon}" aria-hidden="true"></i>
        <div>
          <strong>${escapeHtml(it.label)}</strong>
          ${it.value ? `<small>${escapeHtml(it.value)}</small>` : ''}
        </div>
      </div>
    `).join('');
  }

  // ======================================================================
  // SEAT MAP DRAWER (right-side overlay)
  // ======================================================================
  let seatsByEmdId = new Map();   // emdId -> prebook service, for pricing
  let seatDrawerEl = null;
  let seatDrawerPanel = null;
  let seatDrawerBody = null;
  let seatLegIndex = 0;           // which leg the map belongs to

  /** Price of a seat tier, resolved from the AeroPrebook service list. */
  function seatPrice(emdId) {
    const svc = seatsByEmdId.get(Number(emdId));
    return svc ? svc.price : null;
  }

  function setupSeatDrawer() {
    seatDrawerEl = $('seatDrawer');
    seatDrawerBody = $('seatDrawerBody');
    if (!seatDrawerEl) return;

    seatDrawerPanel = seatDrawerEl.querySelector('.ntb-flight-drawer-panel');

    seatDrawerEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-seat-close]')) { closeSeatMap(); return; }

      // Pick / unpick a seat.
      const seatBtn = event.target.closest('[data-seat]');
      if (seatBtn && !seatBtn.disabled) { toggleSeat(seatBtn); return; }

      // Switch between Departure / Return.
      const legTab = event.target.closest('[data-seat-leg]');
      if (legTab) {
        seatLegIndex = Number(legTab.dataset.seatLeg);
        loadSeatMap();
        return;
      }

      // Retry after the supplier's "Internal error".
      if (event.target.closest('[data-seat-retry]')) loadSeatMap();
    });

    const btn = $('seatMapBtn');
    if (btn) btn.addEventListener('click', openSeatMap);
  }

  function openSeatMap() {
    if (!seatDrawerEl) return;
    lastFocused = document.activeElement;
    seatLegIndex = 0;

    seatDrawerEl.hidden = false;
    requestAnimationFrame(() => {
      seatDrawerEl.classList.add('is-open');
      document.body.classList.add('ntb-flight-open');
      if (seatDrawerPanel) seatDrawerPanel.focus();
    });

    // Seat tiers share their ids with the prebook services, which is where the
    // prices come from.
    if (!seatsByEmdId.size) {
      [...(prebook.emd || []), ...(prebook.services || [])].forEach((s) => seatsByEmdId.set(s.id, s));
    }

    loadSeatMap();
  }

  function closeSeatMap() {
    if (!seatDrawerEl || !seatDrawerEl.classList.contains('is-open')) return;
    seatDrawerEl.classList.remove('is-open');
    document.body.classList.remove('ntb-flight-open');
    const finish = () => {
      seatDrawerEl.hidden = true;
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
    if (seatDrawerPanel) seatDrawerPanel.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400);
  }

  /** Departure / Return tabs, only when there is more than one leg. */
  function renderSeatTabs() {
    const tabs = $('seatLegTabs');
    if (!tabs) return;
    const legs = flight.legs || [];
    if (legs.length < 2) { tabs.innerHTML = ''; return; }

    tabs.innerHTML = legs.map((leg, i) => `
      <button type="button" class="ntb-seat-tab${i === seatLegIndex ? ' is-active' : ''}"
              data-seat-leg="${i}" role="tab" aria-selected="${i === seatLegIndex}">
        ${i === 0 ? 'Departure' : 'Return'}
        <small>${escapeHtml(leg.departureCode)} → ${escapeHtml(leg.arrivalCode)}</small>
      </button>
    `).join('');
  }

  async function loadSeatMap() {
    const leg = (flight.legs || [])[seatLegIndex] || {};
    const seg = (leg.segments || [])[0] || {};
    const flightNum = seg.FlightNum || leg.flightNumber || '';

    seatDrawerBody.innerHTML = `
      <div class="ntb-seat-tabs" id="seatLegTabs"></div>
      <div class="ntb-drawer-loading">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading seat map…</span>
        </div>
        <p>Loading seat map…</p>
      </div>
    `;
    renderSeatTabs();

    if (!flightNum) {
      renderSeatUnavailable('This flight does not expose a flight number, so the seat map cannot be loaded.');
      return;
    }

    let map;
    try {
      map = await window.FlightDataService.getSeatMap(flight.id, searchGuid, flightNum, seatLegIndex + 1);
    } catch (error) {
      renderSeatError(error.message);
      return;
    }

    if (!map.available) {
      renderSeatUnavailable(map.reason || 'No seat map is available for this flight.');
      return;
    }

    renderSeatMap(map, leg);
  }

  function renderSeatUnavailable(reason) {
    seatDrawerBody.innerHTML = `
      <div class="ntb-seat-tabs" id="seatLegTabs"></div>
      <div class="ntb-drawer-error">
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        <h3>No seat map for this flight</h3>
        <p>${escapeHtml(reason)}</p>
        <p class="ntb-seat-hint">
          You can carry on with your booking — the airline will assign a seat, or you can ask at check-in.
        </p>
        <button type="button" class="ntb-btn-outline" data-seat-retry>Try again</button>
      </div>
    `;
    renderSeatTabs();
  }

  function renderSeatError(message) {
    seatDrawerBody.innerHTML = `
      <div class="ntb-seat-tabs" id="seatLegTabs"></div>
      <div class="ntb-drawer-error">
        <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
        <h3>We couldn’t load the seat map</h3>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="ntb-btn-outline" data-seat-retry>Try again</button>
      </div>
    `;
    renderSeatTabs();
  }

  function renderSeatLegend() {
    const prices = (prebook.emd || []).map((e) => e.price).filter((p) => p > 0).sort((a, b) => a - b);
    return `
      <div class="ntb-seat-legend">
        <span class="ntb-seat-key"><i class="ntb-seat-swatch is-free"></i>Available</span>
        <span class="ntb-seat-key"><i class="ntb-seat-swatch is-taken"></i>Unavailable</span>
        <span class="ntb-seat-key"><i class="ntb-seat-swatch is-picked"></i>Selected</span>
        ${prices.length ? `<span class="ntb-seat-key ntb-seat-key-price">Seats from ${fmt(prices[0])}</span>` : ''}
      </div>
    `;
  }

  function renderSeatMap(map, leg) {
    const letters = map.seatLetters || [];
    const selected = selections.filter((s) => s.kind === 'seat' && s.legIndex === seatLegIndex);

    const rowsHtml = map.rows.map((row) => {
      const seatCells = row.seats.map((seat, idx) => {
        const isPicked = selected.some((s) => s.rowNumber === row.number && s.seatCode === seat.code);
        const price = seat.emdId != null ? seatPrice(seat.emdId) : null;
        const selectable = seat.available && seat.emdId != null;

        const title = [
          `${row.number}${seat.code}`,
          seat.labels.join(', '),
          price != null ? fmt(price) : ''
        ].filter(Boolean).join(' · ');

        const classes = ['ntb-seat'];
        if (isPicked) classes.push('is-picked');
        else if (selectable) classes.push('is-free');
        else classes.push('is-taken');

        // Mark the aisle so the grid reads like a real cabin.
        const gap = idx > 0 && row.seats[idx - 1] && !row.seats[idx - 1].aisle && seat.aisle
          ? ' ntb-seat-aisle-before' : '';

        return `
          <button type="button" class="${classes.join(' ')}${gap}"
                  data-seat="${escapeHtml(`${row.number}${seat.code}`)}"
                  data-seat-row="${row.number}"
                  data-seat-code="${escapeHtml(seat.code)}"
                  data-seat-emd="${seat.emdId == null ? '' : seat.emdId}"
                  data-seat-price="${price == null ? '' : price}"
                  title="${escapeHtml(title)}"
                  ${selectable ? '' : 'disabled'}>
            ${escapeHtml(seat.code)}
          </button>
        `;
      }).join('');

      return `
        <div class="ntb-seat-row">
          <span class="ntb-seat-rowno">${row.number}</span>
          <div class="ntb-seat-cells">${seatCells}</div>
          <span class="ntb-seat-rowno">${row.number}</span>
        </div>
      `;
    }).join('');

    seatDrawerBody.innerHTML = `
      <div class="ntb-seat-tabs" id="seatLegTabs"></div>

      <div class="ntb-seat-head">
        <div>
          <strong>${escapeHtml(leg.departureCode)} → ${escapeHtml(leg.arrivalCode)}</strong>
          <small>${escapeHtml(map.flightNum || '')} · ${escapeHtml(leg.airline || '')}${
            map.rows[0] && map.rows[0].flightClass ? ` · ${escapeHtml(map.rows[0].flightClass)}` : ''
          }</small>
        </div>
        <span class="ntb-seat-count">${map.availableCount} of ${map.seatCount} free</span>
      </div>

      ${renderSeatLegend()}

      <div class="ntb-seat-grid">
        <div class="ntb-seat-row ntb-seat-letters">
          <span class="ntb-seat-rowno"></span>
          <div class="ntb-seat-cells">
            ${letters.map((l) => `<span class="ntb-seat-letter">${escapeHtml(l)}</span>`).join('')}
          </div>
          <span class="ntb-seat-rowno"></span>
        </div>
        ${rowsHtml}
      </div>

      <p class="ntb-seat-note">
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        Seat prices are the airline’s own. Your selection is added to the order summary.
      </p>
    `;
    renderSeatTabs();
  }

  /** Select or deselect a seat. One seat per traveller per leg. */
  function toggleSeat(seatBtn) {
    const rowNumber = Number(seatBtn.dataset.seatRow);
    const seatCode = seatBtn.dataset.seatCode;
    const emdId = seatBtn.dataset.seatEmd ? Number(seatBtn.dataset.seatEmd) : null;
    const price = seatBtn.dataset.seatPrice ? Number(seatBtn.dataset.seatPrice) : 0;
    const label = `${rowNumber}${seatCode}`;

    const existing = selections.findIndex(
      (s) => s.kind === 'seat' && s.legIndex === seatLegIndex &&
        s.rowNumber === rowNumber && s.seatCode === seatCode
    );

    if (existing !== -1) {
      selections.splice(existing, 1);
    } else {
      // One seat per leg: drop any other pick for this leg first.
      const otherIdx = selections.findIndex((s) => s.kind === 'seat' && s.legIndex === seatLegIndex);
      if (otherIdx !== -1) selections.splice(otherIdx, 1);

      const leg = flight.legs[seatLegIndex] || {};
      selections.push({
        id: emdId,
        kind: 'seat',
        label: `${leg.departureCode} → ${leg.arrivalCode} seat ${label}`,
        price,
        type: 'EmdSeat',
        rph: seatLegIndex + 1,
        legIndex: seatLegIndex,
        rowNumber,
        seatCode
      });
    }

    // Re-sync the grid highlight with the selection list.
    seatDrawerBody.querySelectorAll('.ntb-seat').forEach((elBtn) => {
      const on = selections.some(
        (s) => s.kind === 'seat' && s.legIndex === seatLegIndex &&
          s.rowNumber === Number(elBtn.dataset.seatRow) && s.seatCode === elBtn.dataset.seatCode
      );
      elBtn.classList.toggle('is-picked', on);
      elBtn.classList.toggle('is-free', !on);
    });

    renderOrderSummary();
    updateSeatSummaryLine();
  }

  /** "Seats selected: …" line under the Flight Summary. */
  function updateSeatSummaryLine() {
    const el = $('seatSummary');
    if (!el) return;
    const seats = selections.filter((s) => s.kind === 'seat');
    if (!seats.length) { el.textContent = ''; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<i class="bi bi-check-circle" aria-hidden="true"></i> Seat${
      seats.length > 1 ? 's' : ''
    } selected: ${seats.map((s) => escapeHtml(s.label)).join(' · ')}`;
  }

  // ======================================================================
  // FLIGHT DETAILS DRAWER (right-side overlay)
  // ======================================================================
  function setupFlightDrawer() {
    drawerEl = $('flightDrawer');
    drawerPanel = drawerEl ? drawerEl.querySelector('.ntb-flight-drawer-panel') : null;
    drawerBody = $('flightDrawerBody');
    if (!drawerEl) return;

    // Delegated clicks: close, leg tabs, and Continue.
    drawerEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-flight-close]')) { closeFlightDetails(); return; }

      const tab = event.target.closest('[data-fd-tab]');
      if (tab) {
        const index = Number(tab.dataset.fdTab);
        drawerEl.querySelectorAll('[data-fd-tab]').forEach((b) => {
          const on = Number(b.dataset.fdTab) === index;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        drawerEl.querySelectorAll('[data-fd-panel]').forEach((p) => {
          const on = Number(p.dataset.fdPanel) === index;
          p.classList.toggle('is-active', on);
          p.hidden = !on;
        });
        return;
      }

      if (event.target.closest('#flightDrawerContinue')) {
        closeFlightDetails();
        const target = $('confirmBookBtn') || $('bookingForm');
        if (target && typeof target.scrollIntoView === 'function') {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });

    // ESC closes whichever drawer is open (Flight Details or the seat map).
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' && event.key !== 'Tab') return;

      const seatOpen = seatDrawerEl && seatDrawerEl.classList.contains('is-open');
      const detailsOpen = drawerEl.classList.contains('is-open');
      if (!seatOpen && !detailsOpen) return;

      const panelEl = seatOpen ? seatDrawerPanel : drawerEl.querySelector('.ntb-flight-drawer-panel');

      if (event.key === 'Escape') {
        event.preventDefault();
        if (seatOpen) closeSeatMap();
        else closeFlightDetails();
      } else {
        trapFocusIn(panelEl, event);
      }
    });

    $('flightDetailsBtn').addEventListener('click', openFlightDetails);

    drawerBody.innerHTML = renderSegments(flight.legs || []);
    renderDrawerFare();
  }

  /** Fare per adult shown in the drawer footer. */
  function renderDrawerFare() {
    const el = $('flightDrawerPrice');
    if (!el) return;
    const price = (prebook && prebook.fullPrice) || (flight.price && flight.price.totalPrice)
      || flight.basePrice || 0;
    el.textContent = fmt(price);
  }

  function openFlightDetails() {
    if (!drawerEl) return;
    lastFocused = document.activeElement;

    drawerEl.hidden = false;
    requestAnimationFrame(() => {
      drawerEl.classList.add('is-open');
      document.body.classList.add('ntb-flight-open');
      if (drawerPanel) drawerPanel.focus();
    });
  }

  function closeFlightDetails() {
    if (!drawerEl || !drawerEl.classList.contains('is-open')) return;

    drawerEl.classList.remove('is-open');
    document.body.classList.remove('ntb-flight-open');

    const finish = () => {
      drawerEl.hidden = true;
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };
    if (drawerPanel) drawerPanel.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 400);
  }

  /** Keep keyboard focus inside an open drawer panel. */
  function trapFocusIn(panelEl, event) {
    if (!panelEl) return;
    const focusables = panelEl.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.prototype.filter.call(focusables, (el) => el.offsetParent !== null || el === panelEl);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

/**
 * Full itinerary for the Flight Details drawer, laid out like the reference:
 *
 *   [ Departure flight ] [ Return flight ]     <- tabs
 *   New York (NYC) -> Los Angeles (LAX)
 *   24 Jul 2026, Nonstop (Travel Time: 3h 20m)
 *   [logo] United Airlines AI-860 . Economy      Flight time 3h 50m
 *          Operated by : United Airlines
 *   (o) Sat, 18 Apr . 04:50 AM
 *    |  JFK-John F Kennedy Intl Airport
 *   (o) Sat, 18 Apr . 07:00 AM
 *       LHR-London Heathrow Airport
 *   (clock) Layover : 1h 10m (LHR-London Heathrow Airport)
 *   ...
 *   Baggage Information
 */
function renderSegments(legs) {
  const isRound = isRoundTrip();
  const cabins = new Set();

  const tabs = isRound
    ? `<div class="ntb-fd-tabs" role="tablist">
         ${legs.map((leg, i) => `
           <button type="button" role="tab" class="ntb-fd-tab${i === 0 ? ' is-active' : ''}"
                   data-fd-tab="${i}" aria-selected="${i === 0}">
             ${i === 0 ? 'Departure flight' : 'Return flight'}
           </button>
         `).join('')}
       </div>`
    : '';

  const panels = legs.map((leg, li) => {
    const segments = Array.isArray(leg.segments) ? leg.segments : [];
    const totalStops = Math.max(0, segments.length - 1);
    const totalMinutes = leg.durationMinutes
      || segments.reduce((sum, s) => sum + (Number(s.FlightMinutes) || 0), 0);

    // Route heading: "New York (NYC) -> Los Angeles (LAX)". The provider
    // sometimes leaves arrivalCity blank, so fall back to the last segment's
    // arrival airport (resolved to a city name when we have one).
    const lastSeg = segments[segments.length - 1] || {};
    const lastArrCode = String((lastSeg.Arrival && lastSeg.Arrival.Iata) || leg.arrivalCode || '').toUpperCase();
    const arrivalCity = leg.arrivalCity
      || (airportIndexFor()[lastArrCode] || {}).city
      || '';
    const from = leg.departureCity
      ? `${leg.departureCity} (${leg.departureCode})`
      : leg.departureCode;
    const to = arrivalCity && arrivalCity !== lastArrCode
      ? `${arrivalCity} (${lastArrCode})`
      : lastArrCode;

    const blocks = [];

    segments.forEach((seg, si) => {
      const { depTime, arrTime, dayOffset } = segmentTimes(seg);
      const dep = seg.Departure || {};
      const arr = seg.Arrival || {};
      const segMinutes = Number(seg.FlightMinutes) || 0;
      if (seg.FlightClass) cabins.add(seg.FlightClass);

      const airlineName = seg.MarketingAirlineName
        || airlineNameOf(seg.MarketingAirline, leg.airline)
        || leg.airline
        || '';
      const operatingCode = seg.OperatingAirline;
      const operatingName = operatingCode && operatingCode !== seg.MarketingAirline
        ? airlineNameOf(operatingCode, leg.operatingAirline)
        : '';

      const when = (date, time, offset) => {
        const day = formatWeekdayShort(date);
        const clock = formatTime12(time);
        return [day, clock].filter(Boolean).join(' \u00b7 ') + (offset || '');
      };

      blocks.push(`
        <div class="ntb-fd-segcard">
          <div class="ntb-fd-segcard-logo">${airlineLogoBlock(seg.MarketingAirline || leg.airlineCode)}</div>
          <div class="ntb-fd-segcard-main">
            <div class="ntb-fd-segcard-title">
              <strong>${escapeHtml(airlineName)}</strong>
              <span>${escapeHtml(seg.FlightNum || '')}${
                seg.FlightClass ? ` \u00b7 ${escapeHtml(cabinLabel(seg.FlightClass))}` : ''
              }</span>
            </div>
            <p class="ntb-fd-segcard-op">
              Operated by : ${escapeHtml(operatingName || airlineName)}
            </p>
          </div>
          ${segMinutes ? `
            <div class="ntb-fd-segcard-time">
              Flight time ${escapeHtml(formatDuration(segMinutes))}
            </div>
          ` : ''}
        </div>
      `);

      blocks.push(`
        <div class="ntb-fd-tl">
          <div class="ntb-fd-tl-point">
            <span class="ntb-fd-tl-dot is-dep"><i class="bi bi-airplane-fill" aria-hidden="true"></i></span>
            <div class="ntb-fd-tl-info">
              <span class="ntb-fd-tl-when">${escapeHtml(when(dep.Date, depTime, ''))}</span>
              <strong class="ntb-fd-tl-where">${escapeHtml(airportLabel(dep.Iata))}</strong>
              ${dep.Terminal ? `<small>Terminal ${escapeHtml(dep.Terminal)}</small>` : ''}
            </div>
          </div>

          <div class="ntb-fd-tl-link" aria-hidden="true"></div>

          <div class="ntb-fd-tl-point">
            <span class="ntb-fd-tl-dot is-arr"><i class="bi bi-airplane-fill" aria-hidden="true"></i></span>
            <div class="ntb-fd-tl-info">
              <span class="ntb-fd-tl-when">${escapeHtml(when(arr.Date, arrTime, dayOffset))}</span>
              <strong class="ntb-fd-tl-where">${escapeHtml(airportLabel(arr.Iata))}</strong>
              ${arr.Terminal ? `<small>Terminal ${escapeHtml(arr.Terminal)}</small>` : ''}
            </div>
          </div>
        </div>
      `);

      // Layover before the next segment.
      if (si < segments.length - 1) {
        const next = segments[si + 1];
        const mins = minutesBetween(seg, next);
        const code = arr.Iata || '';
        blocks.push(`
          <div class="ntb-fd-layover">
            <i class="bi bi-clock" aria-hidden="true"></i>
            <span>Layover : ${escapeHtml(formatDuration(mins))}${
              code ? ` (${escapeHtml(airportLabel(code))})` : ''
            }</span>
          </div>
        `);
      }
    });

    return `
      <section class="ntb-fd-panel${li === 0 ? ' is-active' : ''}" data-fd-panel="${li}"
               ${li === 0 ? '' : 'hidden'}
               aria-label="${li === 0 ? 'Departure flight' : 'Return flight'}">
        <header class="ntb-fd-route">
          <h3>${escapeHtml(from)} <i class="bi bi-arrow-right" aria-hidden="true"></i> ${escapeHtml(to)}</h3>
          <p>${escapeHtml(formatDateFull(leg.departureDate))}, ${
            totalStops === 0 ? 'Nonstop' : `${totalStops} Stop${totalStops > 1 ? 's' : ''}`
          } (Travel Time: ${escapeHtml(formatDuration(totalMinutes))})</p>
        </header>

        ${blocks.join('') || '<p class="ntb-order-empty">No segment detail returned for this leg.</p>'}
      </section>
    `;
  }).join('');

  return `
    ${tabs}
    ${panels}
    ${renderDrawerBaggage(legs)}
  `;
}

  /**
   * IATA -> airport record for the codes in this search.
   *
   * Comes from the search response (`getFlights.lastAirports`), which the server
   * builds by merging the provider's map with data/airports.json. That means the
   * drawer can render "JFK-John F Kennedy Intl Airport" without a second fetch.
   */
  function airportIndexFor() {
    const svc = window.FlightDataService;
    return (svc && svc.getFlights && svc.getFlights.lastAirports) || {};
  }

  /** "JFK-John F Kennedy Intl Airport", falling back to the bare code. */
  function airportLabel(code) {
    const iata = String(code || '').toUpperCase();
    if (!iata) return '';
    const found = airportIndexFor()[iata];
    return found && found.name ? `${iata}-${found.name}` : iata;
  }

  /** Airline display name for a marketing/operating code, with a fallback. */
  function airlineNameOf(code, fallback) {
    const c = String(code || '').toUpperCase();
    if (!c) return fallback || '';
    const map = (window.AIRLINE_NAMES || {})[c];
    return map || fallback || c;
  }

/** Logo + code fallback, same behaviour as the summary card. */
function airlineLogoBlock(code) {
  const logo = window.getAirlineLogo ? window.getAirlineLogo(code) : '';
  const fallback = escapeHtml(code || '--');
  return logo
    ? `<img src="${logo}" alt="${fallback}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
       <span class="ntb-fs-logo-fallback" style="display:none">${fallback}</span>`
    : `<span class="ntb-fs-logo-fallback" style="display:flex">${fallback}</span>`;
}

/** "Econom" -> "Economy" */
function cabinLabel(value) {
  const v = String(value || '');
  if (/^econom/i.test(v)) return 'Economy';
  if (/^business/i.test(v)) return 'Business';
  if (/^premium/i.test(v)) return 'Premium Economy';
  if (/^first/i.test(v)) return 'First';
  return v;
}

/**
 * Baggage Information block for the drawer.
 *
 * The provider reports the allowance per segment; the drawer shows the first
 * non-empty allowance found and marks it "Included".
 */
function renderDrawerBaggage(legs) {
  const segments = [];
  legs.forEach((leg) => {
    (Array.isArray(leg.segments) ? leg.segments : []).forEach((s) => segments.push(s));
  });

  const describe = (bag) => {
    if (!bag || !bag.Count) return null;
    const count = String(bag.Count);
    const kind = String(bag.BaggageType || '').toLowerCase();
    if (kind.includes('kilo')) return `${count} kg`;
    if (kind.includes('piece')) return `${count} Piece${count === '1' ? '' : 's'}`;
    return `${count} ${bag.BaggageType || ''}`.trim();
  };

  let cabin = null;
  let checked = null;
  segments.forEach((seg) => {
    if (!cabin) cabin = describe(seg.CabinBaggage);
    if (!checked) checked = describe(seg.Baggage);
  });

  const rows = [
    {
      icon: 'bi-bag',
      title: 'Personal Item (Small bag)',
      sub: 'Purse, small backpack, briefcase',
      included: true
    },
    {
      icon: 'bi-bag-check',
      title: `Carry-on Bag (${cabin || '0 Piece'})`,
      sub: '',
      included: Boolean(cabin)
    },
    {
      icon: 'bi-suitcase2',
      title: `Checked Bag (${checked || '0 Piece'})`,
      sub: '',
      included: Boolean(checked)
    }
  ];

  return `
    <section class="ntb-fd-bags">
      <h3>Baggage Information</h3>
      ${rows.map((r) => `
        <div class="ntb-fd-bagrow ${r.included ? 'is-ok' : 'is-no'}">
          <i class="bi ${r.icon}" aria-hidden="true"></i>
          <div>
            <strong>${escapeHtml(r.title)}</strong>
            ${r.sub ? `<small>${escapeHtml(r.sub)}</small>` : ''}
          </div>
          ${r.included ? '<span class="ntb-fd-bag-inc">Included</span>' : ''}
        </div>
      `).join('')}
    </section>
  `;
}
  // ======================================================================
  // 3. ADD-ONS CARD (on the page)
  // ======================================================================
  function renderAddons() {
    const container = $('addonGroups');
    const hint = $('addonsSourceHint');
    const emptyEl = $('addonsEmpty');

    const tariffs = prebook.tariffs || [];
    const services = prebook.services || [];
    const emd = prebook.emd || [];

    // Seat tiers (EmdSeat) are picked on the real seat map in the "Select Seat"
    // drawer, so they are not listed here. Everything else in `emd` is a genuine
    // add-on (extra bag, etc.) and does belong in this list.
    const otherEmd = emd.filter((s) => s.type !== 'EmdSeat');

    const optionCount = tariffs.length + services.length + otherEmd.length;
    if (hint) {
      hint.textContent = optionCount ? `${optionCount} option(s) from provider` : 'none available';
    }

    if (!optionCount) {
      container.innerHTML = renderRequests();
      emptyEl.hidden = true;
      return;
    }

    container.hidden = false;
    emptyEl.hidden = true;

    // Group remaining services by their `type` value.
    const groups = new Map();
    const push = (item, kind) => {
      const key = item.type || 'Other';
      if (!groups.has(key)) groups.set(key, { type: key, kind, items: [] });
      groups.get(key).items.push(item);
    };
    tariffs.forEach((t) => push(t, 'tariff'));
    services.forEach((s) => push(s, 'service'));
    otherEmd.forEach((s) => push(s, 'emd'));

    let html = '';
    groups.forEach((group) => {
      const isTariff = group.kind === 'tariff';
      html += `
        <div class="ntb-addon-group">
          <div class="ntb-addon-group-head">
            <h3>${escapeHtml(labelForType(group.type))}</h3>
            <span class="ntb-addon-tag">${isTariff ? 'Fare option' : 'From provider'}</span>
          </div>
          <div class="ntb-addon-options">
            ${group.items.map((item) => renderAddonOption(item, group)).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html + renderRequests();
  }

  function renderAddonOption(item, group) {
    const isTariff = group.kind === 'tariff';
    const inputType = isTariff || group.type === 'Insurance' ? 'radio' : 'checkbox';
    const inputName = isTariff ? 'addonTariff' : `addonSvc-${group.type}`;
    const kind = isTariff ? 'tariff' : (group.kind === 'service' ? 'service' : 'emd');
    // A zero-priced option (e.g. "No insurance") is a valid choice.
    const checked = group.type === 'Insurance' && item.price === 0 ? 'checked' : '';
    const detail = item.text ? String(item.text).replace(/&#xD;/g, '').trim() : '';

    return `
      <label class="ntb-addon-option">
        <input type="${inputType}" name="${escapeHtml(inputName)}"
               data-addon-id="${item.id}"
               data-addon-kind="${kind}"
               data-addon-label="${escapeHtml(item.name)}${item.flightNum ? ' · ' + escapeHtml(item.flightNum) : ''}"
               data-addon-price="${item.price}"
               data-addon-type="${escapeHtml(item.type || '')}"
               data-addon-rph="${item.rph == null ? '' : item.rph}"
               ${checked} />
        <span class="ntb-addon-option-body">
          <span class="ntb-addon-option-top">
            <strong>${escapeHtml(item.name)}${item.flightNum ? ` · ${escapeHtml(item.flightNum)}` : ''}</strong>
            <span class="ntb-addon-option-price">${item.price > 0 ? fmt(item.price) : 'Included'}</span>
          </span>
          ${detail ? `<small class="ntb-addon-option-text">${escapeHtml(detail)}</small>` : ''}
        </span>
      </label>
    `;
  }

  /**
   * Meal / assistance requests per traveller.
   * Not provider services — ServiceInfoType has no Meal member — so they are
   * recorded on the booking and surfaced by the API in `ignoredSelections`.
   */
  function renderRequests() {
    const counts = travellerCounts();
    const rows = [];
    for (let i = 0; i < counts.total; i += 1) {
      rows.push(`
        <div class="ntb-request-row">
          <strong>${escapeHtml(travellerLabel(i, counts))}</strong>
          <div class="ntb-request-fields">
            <label>
              <span>Meal preference</span>
              <select class="ntb-select" data-request="meal" data-request-index="${i}">
                ${MEAL_OPTIONS.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Special assistance</span>
              <select class="ntb-select" data-request="assistance" data-request-index="${i}">
                ${ASSISTANCE_OPTIONS.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
      `);
    }

    return `
      <div class="ntb-addon-group ntb-addon-requests">
        <div class="ntb-addon-group-head">
          <h3>Meal &amp; assistance requests</h3>
          <span class="ntb-addon-tag ntb-addon-tag-soft">Booking request</span>
        </div>
        <p class="ntb-addon-note">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          The provider returns no meal or assistance services for this fare. Your choices are
          recorded as a request and are not charged here.
        </p>
        ${rows.join('')}
      </div>
    `;
  }

  // ======================================================================
  // 3. TRAVELERS
  // ======================================================================
  function travellerCounts() {
    const adults = Math.max(1, Number(params.get('adults') || 1) || 1);
    const children = Math.max(0, Number(params.get('children') || 0) || 0);
    const infants = Math.max(0, Number(params.get('infants') || 0) || 0);
    return { adults, children, infants, total: adults + children + infants };
  }

  function travellerLabel(index, counts) {
    if (index < counts.adults) return `Adult ${index + 1}`;
    const ci = index - counts.adults;
    if (ci < counts.children) return `Child ${ci + 1}`;
    return `Infant ${ci - counts.children + 1}`;
  }

  function travellerAgeType(index, counts) {
    if (index < counts.adults) return 'Adult';
    if (index < counts.adults + counts.children) return 'Child';
    return 'Infant';
  }

  function buildDobDayOptions() {
    let h = '<option value="">Date</option>';
    for (let d = 1; d <= 31; d += 1) {
      const val = String(d).padStart(2, '0');
      h += `<option value="${val}">${d}</option>`;
    }
    return h;
  }

  function buildDobMonthOptions() {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let h = '<option value="">Month</option>';
    months.forEach((m, idx) => {
      const val = String(idx + 1).padStart(2, '0');
      h += `<option value="${val}">${m}</option>`;
    });
    return h;
  }

  function buildDobYearOptions(ageType) {
    const curYear = new Date().getFullYear();
    let startYear = curYear - 12;
    let endYear = curYear - 100;
    if (ageType === 'Child') {
      startYear = curYear - 2;
      endYear = curYear - 12;
    } else if (ageType === 'Infant') {
      startYear = curYear;
      endYear = curYear - 2;
    }
    let h = '<option value="">Year</option>';
    for (let y = startYear; y >= endYear; y -= 1) {
      h += `<option value="${y}">${y}</option>`;
    }
    return h;
  }

  function renderTravellers() {
    const counts = travellerCounts();
    const hint = $('travelersCountHint');
    if (hint) {
      hint.textContent =
        `${counts.adults} adult${counts.adults > 1 ? 's' : ''}` +
        (counts.children ? ` · ${counts.children} child${counts.children > 1 ? 'ren' : ''}` : '') +
        (counts.infants ? ` · ${counts.infants} infant${counts.infants > 1 ? 's' : ''}` : '');
    }

    const out = [];
    for (let i = 0; i < counts.total; i += 1) {
      const isLead = i === 0;
      const open = i === 0;
      const ageType = travellerAgeType(i, counts);
      let headingPrefix = 'Adult';
      if (ageType === 'Child') headingPrefix = 'Child';
      else if (ageType === 'Infant') headingPrefix = 'Infant';

      out.push(`
        <div class="ntb-traveller${open ? ' is-open' : ''}"
             data-traveller-index="${i}" data-age-type="${ageType}">
          <button type="button" class="ntb-traveller-head" data-traveller-toggle="${i}"
                  aria-expanded="${open ? 'true' : 'false'}" aria-controls="travellerBody-${i}">
            <span>
              <strong>Traveler : ${headingPrefix}-${(i % counts.adults) + 1}</strong>
              ${isLead ? '<span class="ntb-traveller-lead">Lead traveller</span>' : ''}
            </span>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="ntb-traveller-body" id="travellerBody-${i}" ${open ? '' : 'hidden'}>
            
            <!-- Row 1: 3 Columns for Names -->
            <div class="ntb-grid ntb-grid-3">
              <div class="ntb-field">
                <label for="firstName-${i}">First Name <span class="ntb-req">*</span></label>
                <input type="text" class="ntb-input" id="firstName-${i}" data-traveller-field="firstName"
                       autocomplete="given-name" placeholder="First Name" />
                <span class="ntb-field-error" data-error-for="firstName-${i}"></span>
              </div>
              <div class="ntb-field">
                <label for="middleName-${i}">Middle Name</label>
                <input type="text" class="ntb-input" id="middleName-${i}" data-traveller-field="middleName"
                       autocomplete="additional-name" placeholder="(Optional)" />
              </div>
              <div class="ntb-field">
                <label for="lastName-${i}">Last Name <span class="ntb-req">*</span></label>
                <input type="text" class="ntb-input" id="lastName-${i}" data-traveller-field="lastName"
                       autocomplete="family-name" placeholder="Last Name" />
                <span class="ntb-field-error" data-error-for="lastName-${i}"></span>
              </div>
            </div>

            <!-- Row 2: Date of Birth (3 selects) + Gender -->
            <div class="ntb-grid ntb-grid-2 ntb-mt-3">
              <div class="ntb-field">
                <label>Date of Birth <span class="ntb-req">*</span></label>
                <div class="ntb-dob-group">
                  <select class="ntb-select" data-dob-part="day" id="dobDay-${i}" aria-label="Day">
                    ${buildDobDayOptions()}
                  </select>
                  <select class="ntb-select" data-dob-part="month" id="dobMonth-${i}" aria-label="Month">
                    ${buildDobMonthOptions()}
                  </select>
                  <select class="ntb-select" data-dob-part="year" id="dobYear-${i}" aria-label="Year">
                    ${buildDobYearOptions(ageType)}
                  </select>
                </div>
                <span class="ntb-field-error" data-error-for="dob-${i}"></span>
              </div>
              <div class="ntb-field">
                <label for="gender-${i}">Gender</label>
                <select class="ntb-select" id="gender-${i}" data-traveller-field="gender">
                  <option value="Male" selected>Male</option>
                  <option value="Female">Female</option>
                  <option value="NoSpecified">Prefer not to say</option>
                </select>
              </div>
            </div>

            <!-- Row 3: Collapsible Additional Requests Box -->
            <div class="ntb-traveller-requests-box ntb-mt-4">
              <button type="button" class="ntb-requests-toggle" data-requests-toggle="${i}"
                      aria-expanded="true" aria-controls="requestsBody-${i}">
                <span>Additional Requests (Meal preferences, Frequent Flyer, Special Assistance)</span>
                <i class="bi bi-dash-circle" aria-hidden="true"></i>
              </button>
              <div class="ntb-requests-body" id="requestsBody-${i}">
                <div class="ntb-grid ntb-grid-3">
                  <div class="ntb-field">
                    <label for="meal-${i}">Meal preference</label>
                    <select class="ntb-select" id="meal-${i}" data-traveller-field="meal">
                      <option value="None">None</option>
                      <option value="Vegetarian">Vegetarian</option>
                      <option value="Non-vegetarian">Non-vegetarian</option>
                      <option value="Jain">Jain</option>
                      <option value="Halal">Halal</option>
                      <option value="Kosher">Kosher</option>
                    </select>
                  </div>
                  <div class="ntb-field">
                    <label for="assistance-${i}">Special assistance</label>
                    <select class="ntb-select" id="assistance-${i}" data-traveller-field="assistance">
                      <option value="None">None</option>
                      <option value="Wheelchair to gate">Wheelchair to gate</option>
                      <option value="Wheelchair to seat">Wheelchair to seat</option>
                      <option value="Vision assistance">Vision assistance</option>
                      <option value="Hearing assistance">Hearing assistance</option>
                      <option value="Priority boarding">Priority boarding</option>
                    </select>
                  </div>
                  <div class="ntb-field">
                    <label for="ffn-${i}">Frequent flyer number</label>
                    <input type="text" class="ntb-input" id="ffn-${i}" data-traveller-field="frequentFlyer"
                           placeholder="Frequent flyer number" />
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      `);
    }

    $('travelersList').innerHTML = out.join('');
  }

  function collectTravellers() {
    const list = [];
    document.querySelectorAll('[data-traveller-index]').forEach((block) => {
      const read = (field) => {
        const el = block.querySelector(`[data-traveller-field="${field}"]`);
        return el ? String(el.value || '').trim() : '';
      };
      const d = block.querySelector('[data-dob-part="day"]')?.value;
      const m = block.querySelector('[data-dob-part="month"]')?.value;
      const y = block.querySelector('[data-dob-part="year"]')?.value;
      const dob = d && m && y ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';

      list.push({
        ageType: block.dataset.ageType,
        firstName: read('firstName'),
        middleName: read('middleName'),
        lastName: read('lastName'),
        dob,
        gender: read('gender') || 'Male',
        frequentFlyer: read('frequentFlyer'),
        meal: read('meal'),
        assistance: read('assistance')
      });
    });
    return list;
  }

  // ======================================================================
  // ORDER SUMMARY (sidebar)
  // ======================================================================
  /**
   * Built from the provider's own numbers:
   *   fare    = AeroPrebook FullPrice (this offer's amount)
   *   add-ons = the exact Price of each selected ServiceInfo
   *
   * AeroSearch only prices ONE adult, so the fare is multiplied by the adult
   * count. Child/infant fares are not exposed by this API and are not invented.
   */
  function renderOrderSummary() {
    const container = $('orderLines');
    if (!container || !flight) return;

    syncSelections();

    const counts = travellerCounts();
    // The provider's own per-adult figure. AeroPrebook FullPrice is the
    // authoritative one once we have it; otherwise use the offer's TotalPrice.
    const perAdult = (prebook && prebook.fullPrice) || (flight.price && flight.price.totalPrice) || flight.basePrice || 0;
    const fareTotal = perAdult * counts.adults;
    const addonTotal = selections.reduce((sum, s) => sum + (s.price || 0), 0);

    const lines = [];
    lines.push(`<div class="ntb-order-line"><span>Adult × ${counts.adults}</span><b>${fmt(perAdult)}</b></div>`);

    // Show the base-fare / taxes split the provider gave us, so the amount is
    // traceable rather than a single opaque number.
    const p = flight.price || {};
    if (p.adultBasePrice != null && p.adultBasePrice > 0) {
      lines.push(`
        <div class="ntb-order-line ntb-order-line-muted">
          <span>Base fare / adult</span><b>${fmt(p.adultBasePrice)}</b>
        </div>
      `);
    }
    if (p.taxes != null && p.taxes > 0) {
      lines.push(`
        <div class="ntb-order-line ntb-order-line-muted">
          <span>Taxes &amp; fees / adult</span><b>${fmt(p.taxes)}</b>
        </div>
      `);
    }

    if (counts.children || counts.infants) {
      lines.push(`
        <div class="ntb-order-line ntb-order-line-muted">
          <span>${counts.children} child · ${counts.infants} infant</span>
          <b>Not priced by provider</b>
        </div>
      `);
    }

    // Seats first, then the other add-ons, so the seat choice is easy to spot.
    const seatPicks = selections.filter((s) => s.kind === 'seat');
    const otherPicks = selections.filter((s) => s.kind !== 'seat');

    seatPicks.forEach((s) => {
      lines.push(`
        <div class="ntb-order-line ntb-order-line-addon">
          <span><i class="bi bi-grid-3x3-gap" aria-hidden="true"></i> ${escapeHtml(s.label)}</span>
          <b>${s.price > 0 ? fmt(s.price) : 'Included'}</b>
        </div>
      `);
    });

    otherPicks.forEach((s) => {
      lines.push(`
        <div class="ntb-order-line ntb-order-line-addon">
          <span>${escapeHtml(s.label)}</span>
          <b>${s.price > 0 ? fmt(s.price) : 'Included'}</b>
        </div>
      `);
    });

    if (!selections.length) {
      lines.push(`
        <div class="ntb-order-line ntb-order-line-muted">
          <span>No extras selected</span><b>—</b>
        </div>
      `);
    }

    container.innerHTML = lines.join('');
    $('orderTotal').textContent = fmt(fareTotal + addonTotal);

    const note = $('orderNote');
    if (note) {
      const cur = (flight.price && flight.price.currency) || prebook && prebook.providerCurrency || 'INR';
      const parts = [`Fare quoted by the airline in ${cur}.`];
      parts.push(`${counts.adults} adult fare${counts.adults > 1 ? 's' : ''}.`);
      if (addonTotal > 0) parts.push(`Add-ons ${fmt(addonTotal)}.`);
      note.textContent = parts.join(' ');
    }
  }

  /**
   * Rebuild the add-on part of `selections` from the checked inputs.
   *
   * IMPORTANT: seats are NOT inputs on this page — they are tracked separately
   * by the seat-map drawer — so they must be preserved here. Replacing the whole
   * array would silently drop every seat the traveller picked.
   */
  function syncSelections() {
    const picked = [];
    document.querySelectorAll('input[data-addon-id]:checked').forEach((input) => {
      picked.push({
        id: Number(input.dataset.addonId),
        kind: input.dataset.addonKind,
        label: input.dataset.addonLabel,
        price: Number(input.dataset.addonPrice) || 0,
        type: input.dataset.addonType,
        rph: input.dataset.addonRph ? Number(input.dataset.addonRph) : null
      });
    });

    const seatPicks = selections.filter((s) => s.kind === 'seat');
    selections = [...seatPicks, ...picked];
  }

  // ======================================================================
  // FORM INTERACTION
  // ======================================================================
  function handleFormInput(event) {
    const target = event.target;

    if (target.id === 'cardNumber') {
      const digits = target.value.replace(/\D/g, '').slice(0, 19);
      target.value = digits.replace(/(.{4})/g, '$1 ').trim();
    }
    if (target.id === 'cardCvv') {
      target.value = target.value.replace(/\D/g, '').slice(0, 4);
    }

    if (target.id) setFieldError(target.id, '');

    // Any add-on change updates the order summary immediately.
    if (target.matches('input[data-addon-id]')) renderOrderSummary();
  }

  function handleFormClick(event) {
    // Per-traveller accordion.
    const toggle = event.target.closest('[data-traveller-toggle]');
    if (toggle) {
      const index = toggle.dataset.travellerToggle;
      const wrap = toggle.closest('.ntb-traveller');
      const body = $(`travellerBody-${index}`);
      if (!body) return;
      const willOpen = body.hidden;
      body.hidden = !willOpen;
      toggle.setAttribute('aria-expanded', String(willOpen));
      if (wrap) wrap.classList.toggle('is-open', willOpen);
      return;
    }

    // Additional requests toggle inside traveler card
    const reqToggle = event.target.closest('[data-requests-toggle]');
    if (reqToggle) {
      const index = reqToggle.dataset.requestsToggle;
      const body = $(`requestsBody-${index}`);
      const icon = reqToggle.querySelector('i');
      if (body) {
        const willOpen = body.hidden;
        body.hidden = !willOpen;
        reqToggle.setAttribute('aria-expanded', String(willOpen));
        if (icon) {
          icon.className = willOpen ? 'bi bi-dash-circle' : 'bi bi-plus-circle';
        }
      }
      return;
    }
  }

  function setFieldError(fieldKey, message) {
    const el = document.querySelector(`[data-error-for="${fieldKey}"]`);
    if (!el) return;
    el.textContent = message || '';
    const field = el.closest('.ntb-field') || el.closest('.ntb-terms') || el.closest('.ntb-terms-wrap');
    if (field) field.classList.toggle('has-error', Boolean(message));
  }

  function clearErrors() {
    document.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; });
    document.querySelectorAll('.ntb-field.has-error, .ntb-terms.has-error').forEach((el) => {
      el.classList.remove('has-error');
    });
  }

  // ======================================================================
  // SUBMIT
  // ======================================================================
  function validate() {
    clearErrors();
    const problems = [];

    const email = String(($('contactEmail') || {}).value || '').trim();
    const rawPhone = String(($('contactPhone') || {}).value || '').replace(/\D/g, '');
    const code = String(($('contactPhoneCode') || {}).value || '').trim();

    if (!rawPhone || rawPhone.length < 6) {
      problems.push({ key: 'contactPhone', message: 'Enter a valid phone number.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      problems.push({ key: 'contactEmail', message: 'Enter a valid email address.' });
    }

    travellers = collectTravellers();
    travellers.forEach((p, i) => {
      if (!p.firstName) problems.push({ key: `firstName-${i}`, message: 'First name is required.' });
      if (!p.lastName) problems.push({ key: `lastName-${i}`, message: 'Last name is required.' });
      if (!p.dob) problems.push({ key: `dob-${i}`, message: 'Date of birth is required.' });
    });

    [['billingAddress', 'Address is required.'],
     ['billingCity', 'City is required.'],
     ['billingState', 'State is required.'],
     ['billingZip', 'Postal code is required.']].forEach(([id, message]) => {
      const el = $(id);
      if (!el || !el.value.trim()) problems.push({ key: id, message });
    });
    const country = $('billingCountry');
    if (!country || !country.value) {
      problems.push({ key: 'billingCountry', message: 'Select a country.' });
    }

    const cardDigits = String(($('cardNumber') || {}).value || '').replace(/\D/g, '');
    if (cardDigits.length < 13) problems.push({ key: 'cardNumber', message: 'Enter a valid card number.' });
    if (!String(($('cardName') || {}).value || '').trim()) {
      problems.push({ key: 'cardName', message: 'Cardholder name is required.' });
    }
    if (!String(($('cardExpiryMonth') || {}).value || '')) {
      problems.push({ key: 'cardExpiryMonth', message: 'Select a month.' });
    }
    if (!String(($('cardExpiryYear') || {}).value || '')) {
      problems.push({ key: 'cardExpiryYear', message: 'Select a year.' });
    }
    if (String(($('cardCvv') || {}).value || '').length < 3) {
      problems.push({ key: 'cardCvv', message: 'Enter the CVV.' });
    }

    const terms = $('termsCheckbox');
    if (!terms || !terms.checked) {
      problems.push({ key: 'termsCheckbox', message: 'Please accept the terms to continue.' });
    }

    return { problems, email, phone: code + rawPhone };
  }

  function collectIgnoredSelections() {
    const ignored = [];
    document.querySelectorAll('[data-request]').forEach((el) => {
      const value = String(el.value || '').trim();
      if (!value) return;
      const index = Number(el.dataset.requestIndex) + 1;
      const isDefault = el.dataset.request === 'meal'
        ? value === MEAL_OPTIONS[0]
        : value === ASSISTANCE_OPTIONS[0];
      if (isDefault) return;
      ignored.push(
        `${el.dataset.request === 'meal' ? 'Meal' : 'Assistance'} · traveller ${index}: ${value}`
      );
    });
    travellers.forEach((p, i) => {
      if (p.frequentFlyer) ignored.push(`Frequent flyer · traveller ${i + 1}: ${p.frequentFlyer}`);
    });
    return ignored;
  }

  async function handleSubmit(event) {
    if (event) event.preventDefault();
    if (isSubmitting) return;

    const { problems, email, phone } = validate();

    if (problems.length) {
      problems.forEach((p) => setFieldError(p.key, p.message));
      setStatus(`Please fix ${problems.length} field${problems.length > 1 ? 's' : ''} above.`, 'error');
      const firstBad = document.querySelector('.has-error input, .has-error select');
      if (firstBad) {
        firstBad.focus();
        if (typeof firstBad.scrollIntoView === 'function') {
          firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      return;
    }

    syncSelections();
    setSubmitting(true);
    setStatus('Confirming your booking…', '');

    const payload = {
      offerCode: flight.id,
      searchGuid,
      email,
      phone,
      customerFio: `${travellers[0].firstName} ${travellers[0].lastName}`.trim(),
      paxList: travellers,
      // Only API-backed selections can be transmitted. Seats travel as EMDs,
      // using the EmdId the seat map returned for the chosen seat.
      selectedEmd: selections
        .filter((s) => s.kind === 'emd' || s.kind === 'seat')
        .filter((s) => s.id != null)
        .map((s) => ({ id: s.id, rph: s.rph || 1, quantity: 1 })),
      selectedServices: selections.filter((s) => s.kind === 'service')
        .map((s) => ({ id: s.id, rph: s.rph || 1 })),
      selectedTariffs: selections.filter((s) => s.kind === 'tariff').map((s) => s.id),
      ignoredSelections: collectIgnoredSelections()
    };

    try {
      const result = await window.FlightDataService.bookFlight(payload);

      if (result.dryRun) {
        setStatus(
          '<i class="bi bi-info-circle" aria-hidden="true"></i> Booking validated but not ' +
            'transmitted — this server has <code>BOOK_DRY_RUN</code> enabled.',
          'ok'
        );
      } else {
        const b = result.booking || {};
        setStatus(
          `<i class="bi bi-check-circle" aria-hidden="true"></i> Booking created${
            b.bookId ? ` — reference <strong>${escapeHtml(String(b.bookId))}</strong>` : ''
          }. Redirecting…`,
          'ok'
        );
        setTimeout(() => { window.location.href = 'confirmation.html'; }, 900);
      }

      if (result.ignoredSelections && result.ignoredSelections.length) {
        console.log('[booking] selections not transmitted to the provider:', result.ignoredSelections);
      }
    } catch (error) {
      setStatus(
        `<i class="bi bi-exclamation-triangle" aria-hidden="true"></i> ${escapeHtml(error.message)}`,
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function setSubmitting(busy) {
    isSubmitting = busy;
    if (!confirmBtn) return;
    confirmBtn.disabled = busy;
    const label = confirmBtn.querySelector('.ntb-btn-label');
    const spinner = confirmBtn.querySelector('.ntb-btn-spinner');
    if (label) label.textContent = busy ? 'Processing…' : 'Confirm & Book';
    if (spinner) spinner.hidden = !busy;
  }

  return { init, openFlightDetails, closeFlightDetails };
})();

window.FlightBooking = FlightBooking;
