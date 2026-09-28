/**
 * NOWTBOOK — Flight Results Controller
 * Handles URL query parsing, dynamic flight rendering from flights.json,
 * interactive filters, sorting, price currency conversion, and search modification.
 */

const FlightResults = (() => {
  let allFlights = [];
  let currentFilteredFlights = [];
  let searchParams = new URLSearchParams(window.location.search);

  const activeFilters = {
    stops: [],
    airlines: [],
    departureTimes: []
  };

  let activeSort = 'Recommended';

  const AIRLINE_COLORS = {
    "EK": "#d71921", "EY": "#bd8b13", "QR": "#5c0632", "TG": "#5b2c8d",
    "SQ": "#f9a01b", "BA": "#075aaa", "LH": "#05164d", "AF": "#002157",
    "KL": "#00a1de", "6E": "#1c3f94", "AI": "#d71921", "UK": "#5b2c8d",
    "SG": "#e31837", "AA": "#0078d2", "DL": "#003366", "TK": "#c70a0c",
    "SV": "#006c35", "WY": "#c8a45c", "GF": "#c8a45c", "ET": "#6c8e3e",
    "FZ": "#ff6b00", "VS": "#e10a0a", "AK": "#ff0000", "MH": "#00529c",
    "CX": "#005d63", "QF": "#e40000", "default": "#1e293b"
  };

  function getAirlineColor(code) {
    return AIRLINE_COLORS[code] || AIRLINE_COLORS.default;
  }

  function getSearchDepartureDate() {
    const depStr = searchParams.get('departure') || '';
    if (!depStr) return 'Oct 12';
    const d = new Date(depStr);
    if (isNaN(d)) return depStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function getSearchReturnDate() {
    const retStr = searchParams.get('return') || '';
    if (!retStr) return 'Oct 19';
    const d = new Date(retStr);
    if (isNaN(d)) return retStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  async function init() {
    searchParams = new URLSearchParams(window.location.search);
    const fromCity = searchParams.get('from') || 'New Delhi';
    const toCity = searchParams.get('to') || 'Dubai';
    const departure = searchParams.get('departure') || 'Oct 14, 2026';
    const returnDate = searchParams.get('return') || 'Oct 21, 2026';
    const trip = searchParams.get('trip') || 'roundtrip';
    const adults = searchParams.get('adults') || '1';
    const cabin = searchParams.get('class') || 'Economy';
    const fromCode = searchParams.get('fromCode') || '';
    const toCode = searchParams.get('toCode') || '';

    const resultFrom = document.getElementById('resultFrom');
    const resultTo = document.getElementById('resultTo');
    if (resultFrom) resultFrom.textContent = `${fromCity}${fromCode ? ' (' + fromCode + ')' : ''}`;
    if (resultTo) resultTo.textContent = `${toCity}${toCode ? ' (' + toCode + ')' : ''}`;

    const resultDates = document.getElementById('resultDates');
    const resultAdults = document.getElementById('resultAdults');

    if (resultDates) {
      resultDates.textContent = trip === 'oneway'
        ? departure
        : `${departure} – ${returnDate}`;
    }
    if (resultAdults) {
      resultAdults.textContent = `${adults} Adult${adults > 1 ? 's' : ''} (${cabin})`;
    }

    allFlights = await window.FlightDataService.getFlights();

    setupModifySearch();
    setupMobileFilterDrawer();
    setupSortChips();
    setupClearAllChips();
    setupFilters();
    applyFiltersAndRender();

    window.addEventListener('ntb:currency-changed', () => {
      buildDynamicStopsFilter();
      buildDynamicAirlineFilter();
      renderFlightList(currentFilteredFlights, {
        hasSearch: Boolean((searchParams.get('fromCode') || '').trim() || (searchParams.get('toCode') || '').trim())
      });
    });
  }

  function setupMobileFilterDrawer() {
    const openBtn = document.getElementById('openFiltersBtn');
    const closeBtn = document.getElementById('closeFiltersBtn');
    const applyBtn = document.getElementById('applyFiltersBtn');
    const filters = document.getElementById('resultsFilters');
    if (!filters) return;

    let backdrop = document.querySelector('.ntb-filter-drawer-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'ntb-filter-drawer-backdrop';
      document.body.appendChild(backdrop);
    }

    function openDrawer() {
      filters.classList.add('open');
      backdrop.classList.add('open');
      document.body.classList.add('ntb-filters-open');
    }

    function closeDrawer() {
      filters.classList.remove('open');
      backdrop.classList.remove('open');
      document.body.classList.remove('ntb-filters-open');
    }

    if (openBtn) openBtn.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (applyBtn) applyBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && filters.classList.contains('open')) {
        closeDrawer();
      }
    });
  }

  function setupModifySearch() {
    const modifyBtn = document.getElementById('modifySearch');
    const panel = document.getElementById('modifySearchPanel');

    let backdrop = document.querySelector('.ntb-modify-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'ntb-modify-backdrop';
      document.body.appendChild(backdrop);
    }

    function openPanel() {
      if (panel) panel.classList.add('open');
      if (backdrop) backdrop.classList.add('open');
      document.body.classList.add('ntb-modify-open');
    }

    function closePanel() {
      if (panel) panel.classList.remove('open');
      if (backdrop) backdrop.classList.remove('open');
      document.body.classList.remove('ntb-modify-open');
    }

    if (modifyBtn) {
      modifyBtn.addEventListener('click', () => {
        if (panel && panel.classList.contains('open')) closePanel();
        else openPanel();
      });
    }

    if (backdrop) backdrop.addEventListener('click', closePanel);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    const searchPanel = document.querySelector('#flight-search-container .ntb-search-panel');
    if (searchPanel && window.FlightSearchForm) {
      window.FlightSearchForm.init(searchPanel, {
        initialValues: {
          from: searchParams.get('from') || 'New Delhi',
          fromCode: searchParams.get('fromCode') || '',
          to: searchParams.get('to') || 'Dubai',
          toCode: searchParams.get('toCode') || '',
          departure: searchParams.get('departure') || '',
          return: searchParams.get('return') || '',
          trip: searchParams.get('trip') || 'roundtrip'
        },
        onSearch: (newParams) => {
          window.location.search = newParams.toString();
        }
      });

      const tripTabsRow = searchPanel.querySelector('.ntb-trip-tabs');
      if (tripTabsRow && !tripTabsRow.querySelector('.ntb-panel-close-btn')) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ntb-panel-close-btn';
        closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
        closeBtn.title = 'Close';
        closeBtn.setAttribute('aria-label', 'Close modify search');
        closeBtn.addEventListener('click', closePanel);
        tripTabsRow.appendChild(closeBtn);
      }
    }
  }

  function setupSortChips() {
    const chips = document.querySelectorAll('.ntb-sort-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
        activeSort = chip.dataset.sort;
        applyFiltersAndRender();
      });
    });
  }

  function setupClearAllChips() {
    const clearBtn = document.getElementById('clearAllChips');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const filtersAside = document.getElementById('resultsFilters');
        if (filtersAside) {
          filtersAside.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
          filtersAside.querySelectorAll('.ntb-time-card').forEach(c => c.classList.remove('active'));
        }
        updateFilterState();
        applyFiltersAndRender();
      });
    }
  }

  function updateActiveChips() {
    const chipsContainer = document.getElementById('activeChips');
    if (!chipsContainer) return;

    const clearBtn = document.getElementById('clearAllChips');
    chipsContainer.querySelectorAll('.ntb-chip').forEach(c => c.remove());

    let chipsHtml = '';

    activeFilters.stops.forEach(stop => {
      const label = stop === 0 ? 'Non-stop' : stop === 1 ? '1 Stop' : '2+ Stops';
      chipsHtml += `
        <div class="ntb-chip">
          <span>Stops: <strong>${label}</strong></span>
          <button type="button" class="ntb-chip-remove" data-type="stops" data-value="${stop}" aria-label="Remove ${label} filter"><i class="bi bi-x" aria-hidden="true"></i></button>
        </div>
      `;
    });

    activeFilters.airlines.forEach(airline => {
      chipsHtml += `
        <div class="ntb-chip">
          <span>Airlines: <strong>${airline}</strong></span>
          <button type="button" class="ntb-chip-remove" data-type="airlines" data-value="${airline}" aria-label="Remove ${airline} filter"><i class="bi bi-x" aria-hidden="true"></i></button>
        </div>
      `;
    });

    activeFilters.departureTimes.forEach(time => {
      const labels = {
        'early-morning': 'Early Morning',
        'morning': 'Morning',
        'afternoon': 'Afternoon',
        'evening': 'Evening',
        'night': 'Night'
      };
      chipsHtml += `
        <div class="ntb-chip">
          <span>Time: <strong>${labels[time] || time}</strong></span>
          <button type="button" class="ntb-chip-remove" data-type="departureTimes" data-value="${time}" aria-label="Remove ${labels[time] || time} filter"><i class="bi bi-x" aria-hidden="true"></i></button>
        </div>
      `;
    });

    if (clearBtn) {
      clearBtn.insertAdjacentHTML('beforebegin', chipsHtml);
    } else {
      chipsContainer.insertAdjacentHTML('beforeend', chipsHtml);
    }

    chipsContainer.querySelectorAll('.ntb-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const value = btn.dataset.value;
        const filtersAside = document.getElementById('resultsFilters');
        if (!filtersAside) return;

        let selector = '';
        if (type === 'stops') selector = `[data-filter="stops"] input[value="${value}"]`;
        else if (type === 'airlines') selector = `[data-filter="airlines"] input[value="${value}"]`;
        else if (type === 'departureTimes') selector = `[data-filter="departure"] input[value="${value}"]`;

        const checkbox = filtersAside.querySelector(selector);
        if (checkbox) checkbox.checked = false;

        if (type === 'departureTimes') {
          const card = filtersAside.querySelector(`.ntb-time-card input[value="${value}"]`)?.closest('.ntb-time-card');
          if (card) card.classList.remove('active');
        }

        updateFilterState();
        applyFiltersAndRender();
      });
    });
  }

  function setupFilters() {
    const filtersAside = document.getElementById('resultsFilters');
    if (!filtersAside) return;

    buildDynamicStopsFilter();
    buildDynamicAirlineFilter();

    filtersAside.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        updateFilterState();
        applyFiltersAndRender();
      });
    });

    filtersAside.querySelectorAll('.ntb-time-card').forEach(card => {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          card.classList.toggle('active', checkbox.checked);
          updateFilterState();
          applyFiltersAndRender();
        }
      });
    });

    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        filtersAside.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        filtersAside.querySelectorAll('.ntb-time-card').forEach(c => c.classList.remove('active'));
        updateFilterState();
        applyFiltersAndRender();
      });
    }
  }

  function buildDynamicStopsFilter() {
    const filtersAside = document.getElementById('resultsFilters');
    if (!filtersAside) return;

    const stopsGroup = filtersAside.querySelector('[data-filter="stops"]');
    if (!stopsGroup) return;

    const routeFlights = getRouteFlights();
    const counts = { 0: 0, 1: 0, 2: 0 };

    routeFlights.forEach(f => {
      const s = f.totalStops !== undefined ? f.totalStops : (f.stops !== undefined ? f.stops : 0);
      const bucket = s >= 2 ? 2 : s;
      if (counts[bucket] !== undefined) counts[bucket]++;
    });

    const header = stopsGroup.querySelector('strong');
    const headerHtml = header ? header.outerHTML : '<strong>Stops</strong>';

    stopsGroup.innerHTML = headerHtml + `
      <label><input type="checkbox" value="0" /> Non-stop <span>${counts[0]}</span></label>
      <label><input type="checkbox" value="1" /> 1 stop <span>${counts[1]}</span></label>
      <label><input type="checkbox" value="2" /> 2+ stops <span>${counts[2]}</span></label>
    `;
  }

  function buildDynamicAirlineFilter() {
    const filtersAside = document.getElementById('resultsFilters');
    if (!filtersAside) return;

    const routeFlights = getRouteFlights();
    const fmtPrice = (window.FlightDataService && window.FlightDataService.formatPrice)
      ? window.FlightDataService.formatPrice
      : (v) => '₹' + Number(v).toLocaleString('en-IN');

    const tableBody = document.getElementById('airlineStopsTable');
    if (tableBody) {
      const airlineMap = {};
      routeFlights.forEach(f => {
        const depLeg = f.legs && f.legs[0] ? f.legs[0] : f;
        const name = depLeg.airline || f.airline;
        const code = depLeg.airlineCode || '';
        const stops = f.totalStops !== undefined ? f.totalStops : 0;
        const price = f.basePrice;

        if (!name) return;
        if (!airlineMap[name]) {
          airlineMap[name] = { code, stop1: null, nonStop: null };
        }
        if (stops > 0) {
          if (airlineMap[name].stop1 === null || price < airlineMap[name].stop1) {
            airlineMap[name].stop1 = price;
          }
        } else {
          if (airlineMap[name].nonStop === null || price < airlineMap[name].nonStop) {
            airlineMap[name].nonStop = price;
          }
        }
      });

      const rows = Object.entries(airlineMap).map(([name, data]) => `
        <div class="ntb-filter-table-row">
          <div class="ntb-table-airline">
            <img src="${getAirlineLogo(data.code)}" alt="${name}"
                 onerror="this.src='https://placehold.co/30x30/1e293b/38bdf8?text=${data.code}'">
          </div>
          <div class="ntb-table-price ${data.stop1 === null ? 'ntb-table-empty' : ''}">
            ${data.stop1 !== null ? fmtPrice(data.stop1) : '-'}
          </div>
          <div class="ntb-table-price ${data.nonStop === null ? 'ntb-table-empty' : ''}">
            ${data.nonStop !== null ? fmtPrice(data.nonStop) : '-'}
          </div>
        </div>
      `).join('');

      tableBody.innerHTML = rows || '<div style="padding:15px;text-align:center;color:#718096;font-size:12px;">No airlines found</div>';
    }

    const airlineGroup = filtersAside.querySelector('[data-filter="airlines"]');
    if (airlineGroup) {
      const airlinePrices = {};
      routeFlights.forEach(f => {
        const depLeg = f.legs && f.legs[0] ? f.legs[0] : f;
        const name = depLeg.airline || f.airline;
        const price = f.basePrice;
        if (name) {
          if (!airlinePrices[name] || price < airlinePrices[name]) {
            airlinePrices[name] = price;
          }
        }
      });

      const sortedAirlines = Object.entries(airlinePrices).sort((a, b) => a[1] - b[1]);

      const listContainer = document.getElementById('airlineCheckboxList');
      const labelsHtml = sortedAirlines.map(([name, price]) => `
        <label>
          <input type="checkbox" value="${name}" />
          ${name}
          <span>${fmtPrice(price)}</span>
        </label>
      `).join('');

      if (listContainer) {
        listContainer.innerHTML = labelsHtml;
      } else {
        const header = airlineGroup.querySelector('strong');
        const headerHtml = header ? header.outerHTML : '<strong>Airlines</strong>';
        airlineGroup.innerHTML = headerHtml + labelsHtml;
      }
    }
  }

  function getRouteFlights() {
    const fromQuery = (searchParams.get('fromCode') || '').toUpperCase().trim();
    const toQuery = (searchParams.get('toCode') || '').toUpperCase().trim();

    return allFlights.filter(f => {
      const flightFrom = f.fromCode
        ? f.fromCode.toUpperCase()
        : (f.legs && f.legs[0] ? f.legs[0].departureCode?.toUpperCase() : '');
      const flightTo = f.toCode
        ? f.toCode.toUpperCase()
        : (f.legs && f.legs[0] ? f.legs[0].arrivalCode?.toUpperCase() : '');

      if (fromQuery && flightFrom !== fromQuery) return false;
      if (toQuery && flightTo !== toQuery) return false;
      return true;
    });
  }

  function updateFilterState() {
    const filtersAside = document.getElementById('resultsFilters');
    if (!filtersAside) return;

    activeFilters.stops = Array.from(filtersAside.querySelectorAll('[data-filter="stops"] input:checked')).map(cb => parseInt(cb.value, 10));
    activeFilters.airlines = Array.from(filtersAside.querySelectorAll('[data-filter="airlines"] input:checked')).map(cb => cb.value);
    activeFilters.departureTimes = Array.from(filtersAside.querySelectorAll('[data-filter="departure"] input:checked')).map(cb => cb.value);

    updateActiveChips();
  }

  function applyFiltersAndRender() {
    const fromQuery = (searchParams.get('fromCode') || '').toUpperCase().trim();
    const toQuery = (searchParams.get('toCode') || '').toUpperCase().trim();
    const hasSearch = Boolean(fromQuery || toQuery);

    let filtered = allFlights.filter(flight => {
      if (fromQuery || toQuery) {
        const flightFrom = flight.fromCode
          ? flight.fromCode.toUpperCase()
          : (flight.legs && flight.legs[0] ? flight.legs[0].departureCode?.toUpperCase() : '');
        const flightTo = flight.toCode
          ? flight.toCode.toUpperCase()
          : (flight.legs && flight.legs[0] ? flight.legs[0].arrivalCode?.toUpperCase() : '');

        if (fromQuery && flightFrom !== fromQuery) return false;
        if (toQuery && flightTo !== toQuery) return false;
      }

      if (activeFilters.stops.length > 0) {
        const flightStops = flight.totalStops !== undefined
          ? flight.totalStops
          : (flight.stops !== undefined ? flight.stops : 0);
        const flightBucket = flightStops >= 2 ? 2 : flightStops;
        if (!activeFilters.stops.includes(flightBucket)) return false;
      }

      if (activeFilters.airlines.length > 0) {
        const depLeg = flight.legs && flight.legs[0] ? flight.legs[0] : flight;
        const airlineName = (depLeg.airline || flight.airline || '').toLowerCase();
        const matchesAirline = activeFilters.airlines.some(a => airlineName.includes(a.toLowerCase()));
        if (!matchesAirline) return false;
      }

      if (activeFilters.departureTimes.length > 0) {
        const depLeg = flight.legs && flight.legs[0] ? flight.legs[0] : flight;
        const depPeriod = depLeg.departurePeriod || flight.departurePeriod || 'morning';
        if (!activeFilters.departureTimes.includes(depPeriod)) return false;
      }

      return true;
    });

    if (activeSort === 'Cheapest first') {
      filtered.sort((a, b) => a.basePrice - b.basePrice);
    } else if (activeSort === 'Fastest first') {
      filtered.sort((a, b) => {
        const durA = a.durationMinutes || (a.legs && a.legs[0] ? a.legs[0].durationMinutes : 999);
        const durB = b.durationMinutes || (b.legs && b.legs[0] ? b.legs[0].durationMinutes : 999);
        return durA - durB;
      });
    } else {
      filtered.sort((a, b) => a.basePrice - b.basePrice);
    }

    const resultCount = document.getElementById('resultCount');
    if (resultCount) {
      resultCount.textContent = `${filtered.length} Flight${filtered.length !== 1 ? 's' : ''} available`;
    }

    if (filtered.length > 0) {
      const cheapest = [...filtered].sort((a, b) => a.basePrice - b.basePrice)[0];
      const fastest = [...filtered].sort((a, b) => {
        const durA = a.durationMinutes || (a.legs && a.legs[0] ? a.legs[0].durationMinutes : 999);
        const durB = b.durationMinutes || (b.legs && b.legs[0] ? b.legs[0].durationMinutes : 999);
        return durA - durB;
      })[0];

      const formatChipValue = (flight) => {
        const price = window.FlightDataService.formatPrice(flight.basePrice);
        const depLeg = flight.legs && flight.legs[0] ? flight.legs[0] : flight;
        return `${price} • ${depLeg.duration || ''}`;
      };

      const bestVal = document.getElementById('bestChipValue');
      const cheapestVal = document.getElementById('cheapestChipValue');
      const fastestVal = document.getElementById('fastestChipValue');

      if (bestVal) bestVal.textContent = formatChipValue(cheapest);
      if (cheapestVal) cheapestVal.textContent = formatChipValue(cheapest);
      if (fastestVal) fastestVal.textContent = formatChipValue(fastest);
    }

    currentFilteredFlights = filtered;
    renderFlightList(filtered, { hasSearch: hasSearch });
  }

  function handleSelectClick(e) {
    const btn = e.target.closest('[data-select-flight]');
    if (!btn) return;

    const flightId = btn.dataset.selectFlight;
    const isSponsored = btn.dataset.sponsored === 'true';

    if (isSponsored) {
      const airlineName = btn.dataset.airlineName || 'flight';
      const price = btn.dataset.price || '';
      alert(`Selected ${airlineName} for ${price}!`);
      return;
    }

    if (!flightId) return;
    const params = new URLSearchParams(window.location.search);
    params.set('id', flightId);
    window.location.href = `booking.html?${params.toString()}`;
  }

  function renderFlightList(flights, options) {
    options = options || {};
    const listContainer = document.querySelector('.ntb-results-list');
    if (!listContainer) return;

    if (!listContainer.dataset.selectListenerAttached) {
      listContainer.dataset.selectListenerAttached = '1';
      listContainer.addEventListener('click', handleSelectClick);
    }

    const trip = searchParams.get('trip') || 'roundtrip';
    const hasSearch = options.hasSearch || false;

    const spinner = document.getElementById('loadingSpinner');
    if (spinner) spinner.remove();

    // ✅ 2 ALAG EMPTY STATES
    if (flights.length === 0) {
      let emptyHtml = '';

      if (hasSearch) {
        const fromCity = searchParams.get('from') || 'your origin';
        const toCity = searchParams.get('to') || 'your destination';
        emptyHtml = `
          <div class="ntb-empty-state">
            <i class="bi bi-airplane" aria-hidden="true"></i>
            <h3>No flights found for this route</h3>
            <p>We couldn't find any flights for <strong>${fromCity}</strong> → <strong>${toCity}</strong>.</p>
            <p>Try changing your travel dates or choosing a different route.</p>
            <a href="index.html" class="ntb-btn-primary">Search again</a>
          </div>
        `;
      } else {
        emptyHtml = `
          <div class="ntb-empty-state">
            <i class="bi bi-funnel" aria-hidden="true"></i>
            <h3>No flights match your filters</h3>
            <p>Try clearing some filters to see more flight options.</p>
            <button type="button" class="ntb-btn-primary" onclick="document.getElementById('resetFilters')?.click()">Reset all filters</button>
          </div>
        `;
      }

      listContainer.innerHTML = emptyHtml;
      return;
    }

    const sponsoredIndex = flights.findIndex((flight) => isSingleAirlineFlight(flight, trip));
    let cardsHtml = '';
    flights.forEach((flight, index) => {
      const isSponsored = index === sponsoredIndex;
      cardsHtml += renderFlightCard(flight, trip, isSponsored);
    });

    listContainer.innerHTML = cardsHtml;
  }

  function isSingleAirlineFlight(flight, trip) {
    const depLeg = flight.legs && flight.legs[0] ? flight.legs[0] : flight;
    const retLeg = flight.legs && flight.legs[1] ? flight.legs[1] : null;

    if (trip === 'oneway') return true;
    if (!retLeg) return false;

    const depCode = (depLeg.airlineCode || '').trim().toUpperCase();
    const retCode = (retLeg.airlineCode || '').trim().toUpperCase();

    if (depCode && retCode) return depCode === retCode;

    const depName = (depLeg.airline || '').trim().toLowerCase();
    const retName = (retLeg.airline || '').trim().toLowerCase();
    return Boolean(depName && retName && depName === retName);
  }

  function renderFlightCard(flight, trip, isSponsored) {
    const formattedPrice = window.FlightDataService.formatPrice(flight.basePrice);

    const depLeg = flight.legs && flight.legs[0] ? flight.legs[0] : flight;
    const retLeg = flight.legs && flight.legs[1] ? flight.legs[1] : null;

    const airlineName = depLeg.airline || 'Airline';
    const airlineCode = depLeg.airlineCode || '';
    const airlineColor = getAirlineColor(airlineCode);

    const destCity = retLeg
      ? (retLeg.arrivalCity || retLeg.arrivalCode)
      : (depLeg.arrivalCity || depLeg.arrivalCode);

    const searchDepDate = getSearchDepartureDate();
    const searchRetDate = getSearchReturnDate();

    const depRowHtml = `
      <div class="ntb-resultcard-leg">
        <div class="ntb-resultcard-leg-row">
          <div class="ntb-resultcard-leg-logo">
            <img src="${getAirlineLogo(depLeg.airlineCode)}" alt="${depLeg.airline}"
                 onerror="this.src='https://placehold.co/40x40/1e293b/38bdf8?text=${depLeg.airlineCode}'">
          </div>
          <div class="ntb-resultcard-time">
            <b>${formatTime12(depLeg.departureTime)}</b>
            <small><b>${depLeg.departureCode}</b> · ${searchDepDate}</small>
          </div>
          <div class="ntb-resultcard-track">
            <b>${depLeg.duration}</b>
            <span class="${depLeg.stops > 0 ? 'has-stop' : ''}">${depLeg.stopInfo}</span>
          </div>
          <div class="ntb-resultcard-time">
            <b>${formatTime12(depLeg.arrivalTime)}</b>
            <small><b>${depLeg.arrivalCode}</b> · ${searchDepDate}</small>
          </div>
        </div>
      </div>
    `;

    const retRowHtml = (trip === 'roundtrip' && retLeg) ? `
      <div class="ntb-resultcard-leg">
        <div class="ntb-resultcard-leg-row">
          <div class="ntb-resultcard-leg-logo">
            <img src="${getAirlineLogo(retLeg.airlineCode)}" alt="${retLeg.airline}"
                 onerror="this.src='https://placehold.co/40x40/1e293b/38bdf8?text=${retLeg.airlineCode}'">
          </div>
          <div class="ntb-resultcard-time">
            <b>${formatTime12(retLeg.departureTime)}</b>
            <small><b>${retLeg.departureCode}</b> · ${searchRetDate}</small>
          </div>
          <div class="ntb-resultcard-track">
            <b>${retLeg.duration}</b>
            <span class="${retLeg.stops > 0 ? 'has-stop' : ''}">${retLeg.stopInfo}</span>
          </div>
          <div class="ntb-resultcard-time">
            <b>${formatTime12(retLeg.arrivalTime)}</b>
            <small><b>${retLeg.arrivalCode}</b> · ${searchRetDate}</small>
          </div>
        </div>
      </div>
    ` : '';

    if (isSponsored) {
      const promoAirlineName = depLeg.airline;
      const promoAirlineCode = depLeg.airlineCode;
      const promoAirlineColor = getAirlineColor(promoAirlineCode);

      return `
        <article class="ntb-resultcard-card" style="border-color: ${promoAirlineColor};" data-flight-id="${flight.id}">
          <div class="ntb-resultcard-banner" style="background: ${promoAirlineColor};">
            <div class="ntb-resultcard-banner-left">
              <div class="ntb-resultcard-logo">
                <img src="${getAirlineLogo(promoAirlineCode)}" alt="${promoAirlineName}"
                     onerror="this.src='https://placehold.co/50x50/ffffff/1e293b?text=${promoAirlineCode}'">
              </div>
              <div class="ntb-resultcard-text">
                <h4>Fly to ${destCity} with ${promoAirlineName}</h4>
                <p>Enjoy flexibility and peace of mind if plans change.</p>
              </div>
            </div>
            <div class="ntb-resultcard-banner-right">
              <span class="ntb-resultcard-label">
                Sponsored <i class="bi bi-info-circle" aria-hidden="true"></i>
              </span>
              <span class="ntb-resultcard-more">More info <i class="bi bi-chevron-down" aria-hidden="true"></i></span>
            </div>
          </div>
          <div class="ntb-resultcard-body">
            <div class="ntb-resultcard-legs">
              <div class="ntb-resultcard-leg-name">${promoAirlineName}</div>
              ${depRowHtml}
              ${retRowHtml}
            </div>
            <div class="ntb-resultcard-cta">
              <small>Book directly with airline</small>
              <strong>${formattedPrice}</strong>
              <small>per adult</small>
              <button style="background: ${promoAirlineColor};"
                      data-select-flight="${flight.id}"
                      data-sponsored="true"
                      data-airline-name="${promoAirlineName}"
                      data-price="${formattedPrice}">
                Select <i class="bi bi-arrow-right" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </article>
      `;
    }

    return `
      <article class="ntb-resultcard-card" data-flight-id="${flight.id}">
        <div class="ntb-resultcard-body">
          <div class="ntb-resultcard-legs">
            <div class="ntb-resultcard-leg-name">${depLeg.airline}${retLeg && retLeg.airline !== depLeg.airline ? ', ' + retLeg.airline : ''}</div>
            ${depRowHtml}
            ${retRowHtml}
          </div>
          <div class="ntb-resultcard-cta">
            <small>from 8 websites</small>
            <strong>${formattedPrice}</strong>
            <small>per adult</small>
            <button class="ntb-btn-primary"
                    data-select-flight="${flight.id}"
                    data-airline-name="${airlineName}"
                    data-price="${formattedPrice}">
              Select <i class="bi bi-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </article>
    `;
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

  return { init };
})();

window.FlightResults = FlightResults;