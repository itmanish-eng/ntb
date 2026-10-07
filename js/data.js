/**
 * NOWTOBOOK — Data Service
 * Loads Airports & Flights from the JSON datasets.
 */

const FlightDataService = (() => {
  /**
   * Backend proxy (server/server.js) that talks to the SiteCity SOAP API.
   *
   * NOTE: currently pointed at 5001. The default is 5000 (see server/.env);
   * a stale server process was still holding 5000 and could not be stopped from
   * inside this session, so the proxy is running on 5001 for now. Set this back
   * to 5000 once only one server instance is running.
   */
  const API_BASE_URL = 'http://localhost:5001';

  const currencyRates = {
    INR: { symbol: '₹', rate: 1.0, format: val => `₹${Math.round(val).toLocaleString('en-IN')}` },
    USD: { symbol: '$', rate: 0.012, format: val => `$${Math.round(val * 0.012).toLocaleString('en-US')}` },
    EUR: { symbol: '€', rate: 0.011, format: val => `€${Math.round(val * 0.011).toLocaleString('de-DE')}` },
    GBP: { symbol: '£', rate: 0.0095, format: val => `£${Math.round(val * 0.0095).toLocaleString('en-GB')}` },
    AED: { symbol: 'د.إ', rate: 0.044, format: val => `AED ${Math.round(val * 0.044).toLocaleString('en-US')}` }
  };

  let activeCurrency = localStorage.getItem('ntb_currency') || 'INR';
  let cachedAirports = null;

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not fetch ${path}: HTTP ${response.status}`);
    return response.json();
  }

  /**
   * Fetch airports list
   */
  async function getAirports() {
    if (!cachedAirports) cachedAirports = await fetchJson('data/airports.json');
    return cachedAirports;
  }

  /**
   * Fetch flights for the current search from the backend SiteCity proxy.
   *
   * The backend (server/server.js) converts the request into a SiteCity SOAP
   * AeroSearch call and returns JSON in the same shape as data/flights.json,
   * so the results page needs no changes.
   *
   * Search context comes from the results.html query string, which
   * js/search.js already populates:
   *   ?fromCode=DEL&toCode=DXB&departure=2026-06-07&return=2026-06-15
   *     &trip=roundtrip&adults=1&class=Economy
   */
  async function getFlights() {
    const params = new URLSearchParams(window.location.search);

    const from = params.get('fromCode') || '';
    const to = params.get('toCode') || '';
    const departure = params.get('departure') || '';
    // NOTE: `return` is a reserved word, so the local is named returnParam.
    const returnParam = params.get('return') || '';
    const adults = params.get('adults') || '1';
    const children = params.get('children') || '0';
    const infants = params.get('infants') || '0';
    const cabin = params.get('class') || 'Economy';

    if (!from || !to || !departure) {
      console.log('[data] getFlights: missing fromCode/toCode/departure in the URL — no search run.');
      return [];
    }

    const query = new URLSearchParams({
      from,
      to,
      departure,
      adults,
      children,
      infants,
      cabin
    });
    if (returnParam) query.set('return', returnParam);

    console.log(`[data] getFlights: requesting ${API_BASE_URL}/api/flights?${query.toString()}`);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/flights?${query.toString()}`);
    } catch (networkError) {
      console.error('[data] getFlights: could not reach the flight API.', networkError);
      throw new Error('Could not reach the flight search service. Is the server running?');
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const message = err.error || `Failed to fetch flights (HTTP ${response.status})`;
      console.error('[data] getFlights failed:', message);
      throw new Error(message);
    }

    const data = await response.json();

    if (!data.success) {
      const message = data.error || 'No flights found';
      console.error('[data] getFlights failed:', message);
      throw new Error(message);
    }

    const flights = data.flights || [];
    console.log(`[data] getFlights: ${flights.length} flight(s) received.`);
    // The search guid is required to pre-book any of these offers.
    getFlights.lastSearchGuid = data.searchGuid || '';
    // IATA -> {city,name,country} for the codes in this result. The server
    // merges the provider's own map with data/airports.json, so the Flight
    // Details timeline can show real airport names.
    getFlights.lastAirports = data.airports || {};
    return flights;
  }

  /**
   * Pre-booking lookup for one offer.
   *
   * SiteCity's AeroPrebook needs BOTH the offer code and the search guid that
   * produced it. Returns fare/tariff options plus the add-on services
   * (insurance, seats, baggage) the provider actually offers for this fare.
   *
   * @param {string} offerCode
   * @param {string} searchGuid
   * @returns {Promise<object>} mapped prebook payload
   */
  async function getPrebook(offerCode, searchGuid) {
    if (!offerCode || !searchGuid) {
      throw new Error('A search guid and offer code are required to load fare options.');
    }

    const query = new URLSearchParams({ offerCode, searchGuid });
    console.log('[data] getPrebook: requesting /api/prebook');

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/prebook?${query.toString()}`);
    } catch (networkError) {
      console.error('[data] getPrebook: could not reach the flight API.', networkError);
      throw new Error('Could not reach the flight search service. Is the server running?');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const message = data.error || `Could not load fare options (HTTP ${response.status})`;
      console.error('[data] getPrebook failed:', message);
      throw new Error(message);
    }

    console.log(
      `[data] getPrebook: ${data.tariffs.length} tariff(s), ` +
        `${data.services.length} service(s), ${data.emd.length} seat/bag option(s).`
    );
    return data;
  }

  /**
   * Cabin seat map for one flight of an offer.
   *
   * Seat prices come from the same service ids the prebook returns (`emdId`), so
   * the caller can look each tier up in the prebook and show a real price.
   *
   * NOTE: this is supplier-dependent. Some flights answer with
   * `available: false` and a reason even though the offer itself is fine, which
   * is reported here rather than thrown.
   *
   * @param {string} offerCode
   * @param {string} searchGuid
   * @param {string} flightNum  e.g. "AI-2678"
   * @param {number} [rph]      1 = outbound, 2 = return
   * @returns {Promise<object>} seat map payload (may have available:false)
   */
  async function getSeatMap(offerCode, searchGuid, flightNum, rph) {
    if (!offerCode || !searchGuid || !flightNum) {
      throw new Error('An offer code, search guid and flight number are required for the seat map.');
    }

    const query = new URLSearchParams({
      offerCode,
      searchGuid,
      flightNum,
      rph: String(rph || 1)
    });
    console.log(`[data] getSeatMap: requesting seat map for ${flightNum}`);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/seatmap?${query.toString()}`);
    } catch (networkError) {
      console.error('[data] getSeatMap: could not reach the flight API.', networkError);
      throw new Error('Could not reach the flight search service. Is the server running?');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const message = data.error || `Could not load the seat map (HTTP ${response.status})`;
      console.error('[data] getSeatMap failed:', message);
      throw new Error(message);
    }

    console.log(
      data.available
        ? `[data] getSeatMap: ${data.rowCount} row(s), ${data.availableCount} seat(s) selectable.`
        : `[data] getSeatMap: no map available (${data.reason})`
    );
    return data;
  }

  /**
   * Submit the booking.
   *
   * @param {object} payload offerCode, searchGuid, paxList, contact details and
   *                         the selected service/tariff ids
   * @returns {Promise<object>} `{ dryRun, booking }` on success
   */
  async function bookFlight(payload) {
    console.log('[data] bookFlight: submitting booking');

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (networkError) {
      console.error('[data] bookFlight: could not reach the flight API.', networkError);
      throw new Error('Could not reach the booking service. Is the server running?');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      const message = data.error || `Booking failed (HTTP ${response.status})`;
      console.error('[data] bookFlight failed:', message);
      throw new Error(message);
    }

    console.log(`[data] bookFlight: success (dryRun=${Boolean(data.dryRun)})`);
    // Kept so the confirmation page can render the booking without another
    // call. sessionStorage survives the redirect and is scoped to the tab.
    try {
      sessionStorage.setItem('ntb_last_booking', JSON.stringify({
        at: Date.now(),
        dryRun: Boolean(data.dryRun),
        booking: data.booking || null,
        request: data.request || null
      }));
    } catch (storageError) {
      console.warn('[data] bookFlight: could not persist the booking for the confirmation page.');
    }
    return data;
  }

  /**
   * Currency helpers
   */
  function getCurrency() {
    return activeCurrency;
  }

  function setCurrency(code) {
    if (currencyRates[code]) {
      activeCurrency = code;
      localStorage.setItem('ntb_currency', code);
      window.dispatchEvent(new CustomEvent('ntb:currency-changed', { detail: { currency: code } }));
    }
  }

  function formatPrice(amountInInr) {
    const config = currencyRates[activeCurrency] || currencyRates.INR;
    return config.format(amountInInr);
  }

  return {
    getAirports,
    getFlights,
    getPrebook,
    getSeatMap,
    bookFlight,
    getCurrency,
    setCurrency,
    formatPrice,
    currencyRates,
    API_BASE_URL
  };
})();

window.FlightDataService = FlightDataService;
