/**
 * NOWTOBOOK — Data Service
 * Loads Airports & Flights from the JSON datasets.
 */

const FlightDataService = (() => {
  const currencyRates = {
    INR: { symbol: '₹', rate: 1.0, format: val => `₹${Math.round(val).toLocaleString('en-IN')}` },
    USD: { symbol: '$', rate: 0.012, format: val => `$${Math.round(val * 0.012).toLocaleString('en-US')}` },
    EUR: { symbol: '€', rate: 0.011, format: val => `€${Math.round(val * 0.011).toLocaleString('de-DE')}` },
    GBP: { symbol: '£', rate: 0.0095, format: val => `£${Math.round(val * 0.0095).toLocaleString('en-GB')}` },
    AED: { symbol: 'د.إ', rate: 0.044, format: val => `AED ${Math.round(val * 0.044).toLocaleString('en-US')}` }
  };

  let activeCurrency = localStorage.getItem('ntb_currency') || 'INR';
  let cachedAirports = null;
  let cachedFlights = null;

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
   * Fetch all flights
   */
  async function getFlights() {
    if (!cachedFlights) cachedFlights = await fetchJson('data/flights.json');
    return cachedFlights;
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
    getCurrency,
    setCurrency,
    formatPrice,
    currencyRates
  };
})();

window.FlightDataService = FlightDataService;
