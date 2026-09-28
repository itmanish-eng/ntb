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

  // ✅ NEW: 3b. Initialize Booking Controller if on booking page
  if (document.body.classList.contains('ntb-booking-page') && window.FlightBooking) {
    window.FlightBooking.init();
  }

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

  // 6. Popular Routes Card Quick Click
  document.querySelectorAll('.ntb-route-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      e.preventDefault();
      const cities = card.querySelectorAll('.ntb-route-cities span');
      if (cities.length !== 2) return;

      const fromCity = cities[0].textContent.trim();
      const toCity = cities[1].textContent.trim();

      await applyAirportToSearch('.ntb-field-from', fromCity);
      await applyAirportToSearch('.ntb-field-to', toCity);

      document.querySelector('.ntb-search-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
});