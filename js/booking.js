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

  /** "31.10.2026" -> "Sat, 31 Oct" */
  function formatDateHuman(ddmmyyyy) {
    const m = String(ddmmyyyy || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return ddmmyyyy || '';
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (Number.isNaN(d.getTime())) return ddmmyyyy;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
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
      for (let m = 1; m <= 12; m += 1) {
        const opt = document.createElement('option');
        opt.value = String(m).padStart(2, '0');
        opt.textContent = String(m).padStart(2, '0');
        monthSelect.appendChild(opt);
      }
    }
    const yearSelect = $('cardExpiryYear');
    if (yearSelect) {
      const startYear = new Date().getFullYear();
      for (let y = startYear; y <= startYear + 12; y += 1) {
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
  // FLIGHT DETAILS DRAWER (right-side overlay)
  // ======================================================================
  function setupFlightDrawer() {
    drawerEl = $('flightDrawer');
    drawerPanel = drawerEl ? drawerEl.querySelector('.ntb-flight-drawer-panel') : null;
    drawerBody = $('flightDrawerBody');
    if (!drawerEl) return;

    // Delegated close: the X button and the backdrop both carry data-flight-close.
    drawerEl.addEventListener('click', (event) => {
      if (event.target.closest('[data-flight-close]')) closeFlightDetails();
    });

    // ESC closes only this drawer.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && drawerEl.classList.contains('is-open')) {
        event.preventDefault();
        closeFlightDetails();
      }
      if (event.key === 'Tab' && drawerEl.classList.contains('is-open')) trapFocus(event);
    });

    $('flightDetailsBtn').addEventListener('click', openFlightDetails);

    drawerBody.innerHTML = renderSegments(flight.legs || []);
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

  /** Keep keyboard focus inside the open drawer. */
  function trapFocus(event) {
    const focusables = drawerPanel.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const list = Array.prototype.filter.call(focusables, (el) => el.offsetParent !== null || el === drawerPanel);
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
   * Full segment list: every leg, every stop, with aircraft, terminals,
   * per-segment baggage and layover blocks between connections.
   */
  function renderSegments(legs) {
    const isRound = isRoundTrip();

    return legs.map((leg, li) => {
      const label = isRound ? (li === 0 ? 'Departure flight' : 'Return flight') : 'Flight';
      const segments = Array.isArray(leg.segments) ? leg.segments : [];
      const parts = [];

      segments.forEach((seg, si) => {
        const { depTime, arrTime, dayOffset } = segmentTimes(seg);
        const dep = seg.Departure || {};
        const arr = seg.Arrival || {};
        const segMinutes = Number(seg.FlightMinutes) || 0;

        parts.push(`
          <div class="ntb-fd-seg">
            <div class="ntb-fd-seg-head">
              <span class="ntb-fd-seg-num">Segment ${si + 1}</span>
              <strong>${escapeHtml(seg.MarketingAirlineName || seg.MarketingAirline || '')}</strong>
              <span class="ntb-fd-seg-flight">${escapeHtml(seg.FlightNum || '')}</span>
            </div>

            <div class="ntb-fd-seg-points">
              <div class="ntb-fd-point">
                <b>${escapeHtml(formatTime12(depTime))}</b>
                <span>${escapeHtml(dep.Iata || '')} · ${escapeHtml(dep.City || dep.Name || '')}</span>
                ${dep.Name && dep.City ? `<small>${escapeHtml(dep.Name)}</small>` : ''}
                ${dep.Terminal ? `<small>Terminal ${escapeHtml(dep.Terminal)}</small>` : ''}
              </div>
              <div class="ntb-fd-point">
                <b>${escapeHtml(formatTime12(arrTime))}${dayOffset}</b>
                <span>${escapeHtml(arr.Iata || '')} · ${escapeHtml(arr.City || arr.Name || '')}</span>
                ${arr.Name && arr.City ? `<small>${escapeHtml(arr.Name)}</small>` : ''}
                ${arr.Terminal ? `<small>Terminal ${escapeHtml(arr.Terminal)}</small>` : ''}
              </div>
            </div>

            <div class="ntb-fd-seg-facts">
              ${seg.AirCraft ? `<span><i class="bi bi-airplane" aria-hidden="true"></i>${escapeHtml(seg.AirCraft)}</span>` : ''}
              ${segMinutes ? `<span><i class="bi bi-clock" aria-hidden="true"></i>${escapeHtml(formatDuration(segMinutes))}</span>` : ''}
              ${seg.FlightClass ? `<span><i class="bi bi-tag" aria-hidden="true"></i>${escapeHtml(seg.FlightClass)}</span>` : ''}
              ${renderSegBaggage(seg)}
            </div>
          </div>
        `);

        // Layover block between this segment and the next.
        if (si < segments.length - 1) {
          const next = segments[si + 1];
          const mins = minutesBetween(seg, next);
          const code = arr.Iata || '';
          parts.push(`
            <div class="ntb-fd-layover">
              <i class="bi bi-clock-history" aria-hidden="true"></i>
              <span>Layover at <strong>${escapeHtml(code)}</strong>${
                arr.Name ? ` · ${escapeHtml(arr.Name)}` : ''
              } — ${escapeHtml(formatDuration(mins))}</span>
            </div>
          `);
        }
      });

      const totalStops = Math.max(0, segments.length - 1);
      const totalMinutes = segments.reduce((sum, s) => sum + (Number(s.FlightMinutes) || 0), 0);

      return `
        <section class="ntb-fd-leg">
          <header class="ntb-fd-leg-head">
            <h3>${escapeHtml(label)}</h3>
            <p>
              ${escapeHtml(leg.departureCode)} → ${escapeHtml(leg.arrivalCode)} ·
              ${escapeHtml(formatDateHuman(leg.departureDate))} ·
              ${totalStops === 0 ? 'Non-stop' : `${totalStops} stop${totalStops > 1 ? 's' : ''}`} ·
              ${escapeHtml(formatDuration(totalMinutes))}
            </p>
          </header>
          ${parts.join('') || '<p class="ntb-order-empty">No segment detail returned for this leg.</p>'}
        </section>
      `;
    }).join('');
  }

  function renderSegBaggage(seg) {
    const out = [];
    const cb = seg.CabinBaggage;
    if (cb && cb.Count) out.push(`Cabin bag: ${cb.Count} ${cb.BaggageType || ''}`.trim());
    const b = seg.Baggage;
    if (b && b.Count) out.push(`Checked: ${b.Count} ${b.BaggageType || ''}`.trim());
    if (!out.length) return '';
    return out
      .map((t) => `<span><i class="bi bi-suitcase2" aria-hidden="true"></i>${escapeHtml(t)}</span>`)
      .join('');
  }

  // ======================================================================
  // 2. ADD-ONS CARD (on the page)
  // ======================================================================
  function renderAddons() {
    const container = $('addonGroups');
    const hint = $('addonsSourceHint');
    const emptyEl = $('addonsEmpty');

    const tariffs = prebook.tariffs || [];
    const services = prebook.services || [];
    const emd = prebook.emd || [];

    if (hint) {
      const n = tariffs.length + services.length + emd.length;
      hint.textContent = n ? `${n} option(s) from provider` : 'none available';
    }

    if (!tariffs.length && !services.length && !emd.length) {
      container.innerHTML = '';
      container.hidden = true;
      emptyEl.hidden = false;
      return;
    }

    container.hidden = false;
    emptyEl.hidden = true;

    // Group the provider's own services by their `type` value.
    const groups = new Map();
    const push = (item, kind) => {
      const key = item.type || 'Other';
      if (!groups.has(key)) groups.set(key, { type: key, kind, items: [] });
      groups.get(key).items.push(item);
    };
    tariffs.forEach((t) => push(t, 'tariff'));
    services.forEach((s) => push(s, 'service'));
    emd.forEach((s) => push(s, 'emd'));

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
      out.push(`
        <div class="ntb-traveller${open ? ' is-open' : ''}"
             data-traveller-index="${i}" data-age-type="${travellerAgeType(i, counts)}">
          <button type="button" class="ntb-traveller-head" data-traveller-toggle="${i}"
                  aria-expanded="${open ? 'true' : 'false'}" aria-controls="travellerBody-${i}">
            <span>
              <strong>${escapeHtml(travellerLabel(i, counts))}</strong>
              ${isLead ? '<span class="ntb-traveller-lead">Lead traveller</span>' : ''}
            </span>
            <i class="bi bi-chevron-down" aria-hidden="true"></i>
          </button>
          <div class="ntb-traveller-body" id="travellerBody-${i}" ${open ? '' : 'hidden'}>
            <div class="ntb-grid ntb-grid-2">
              <div class="ntb-field">
                <label for="firstName-${i}">First name <span class="ntb-req">*</span></label>
                <input type="text" class="ntb-input" id="firstName-${i}" data-traveller-field="firstName"
                       autocomplete="given-name" placeholder="First name" />
                <span class="ntb-field-error" data-error-for="firstName-${i}"></span>
              </div>
              <div class="ntb-field">
                <label for="middleName-${i}">Middle name</label>
                <input type="text" class="ntb-input" id="middleName-${i}" data-traveller-field="middleName"
                       autocomplete="additional-name" placeholder="Optional" />
              </div>
              <div class="ntb-field">
                <label for="lastName-${i}">Last name <span class="ntb-req">*</span></label>
                <input type="text" class="ntb-input" id="lastName-${i}" data-traveller-field="lastName"
                       autocomplete="family-name" placeholder="Last name" />
                <span class="ntb-field-error" data-error-for="lastName-${i}"></span>
              </div>
              <div class="ntb-field">
                <label for="dob-${i}">Date of birth <span class="ntb-req">*</span></label>
                <input type="date" class="ntb-input" id="dob-${i}" data-traveller-field="dob"
                       autocomplete="bday" />
                <span class="ntb-field-error" data-error-for="dob-${i}"></span>
              </div>
              <div class="ntb-field">
                <label for="gender-${i}">Gender</label>
                <select class="ntb-select" id="gender-${i}" data-traveller-field="gender">
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="NoSpecified">Prefer not to say</option>
                </select>
              </div>
              <div class="ntb-field">
                <label for="ffn-${i}">Frequent flyer number</label>
                <input type="text" class="ntb-input" id="ffn-${i}" data-traveller-field="frequentFlyer"
                       placeholder="Optional" />
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
      list.push({
        ageType: block.dataset.ageType,
        firstName: read('firstName'),
        middleName: read('middleName'),
        lastName: read('lastName'),
        dob: read('dob'),
        gender: read('gender'),
        frequentFlyer: read('frequentFlyer')
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

    selections.forEach((s) => {
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
          <span>No add-ons selected</span><b>—</b>
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
    selections = picked;
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
      // Only API-backed selections can be transmitted.
      selectedEmd: selections.filter((s) => s.kind === 'emd')
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
