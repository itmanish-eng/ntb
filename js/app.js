/**
 * NOWTOBOOK — Main App Script
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

  // 5. Trending Tags Quick Click on Homepage
  document.querySelectorAll('.ntb-trending-tag').forEach(tag => {
    tag.addEventListener('click', (e) => {
      e.preventDefault();
      const text = tag.textContent.trim(); // e.g. "Delhi → Goa"
      const parts = text.split('→').map(s => s.trim());
      const searchPanel = document.querySelector('.ntb-search-panel');
      if (parts.length === 2 && searchPanel) {
        const fromInput = searchPanel.querySelector('.ntb-field-from .ntb-airport-input');
        const toInput = searchPanel.querySelector('.ntb-field-to .ntb-airport-input');
        if (fromInput) fromInput.value = parts[0];
        if (toInput) toInput.value = parts[1];

        searchPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  // 6. Popular Routes Card Quick Click
  document.querySelectorAll('.ntb-route-card').forEach(card => {
    card.addEventListener('click', (e) => {
      e.preventDefault();
      const cities = card.querySelectorAll('.ntb-route-cities span');
      const searchPanel = document.querySelector('.ntb-search-panel');
      if (cities.length === 2 && searchPanel) {
        const fromCity = cities[0].textContent.trim();
        const toCity = cities[1].textContent.trim();
        const fromInput = searchPanel.querySelector('.ntb-field-from .ntb-airport-input');
        const toInput = searchPanel.querySelector('.ntb-field-to .ntb-airport-input');
        if (fromInput) fromInput.value = fromCity;
        if (toInput) toInput.value = toCity;

        searchPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
});
