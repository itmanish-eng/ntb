/**
 * NOWTOBOOK — Flight Search Form Controller
 * Reusable logic for Airport selection, Calendar date picker,
 * Passenger/Class selector, validation, and search submission.
 */

const FlightSearchForm = (() => {
  /**
   * Initialize a flight search container
   * @param {HTMLElement|string} rootSelector - The parent container element
   * @param {Object} options - { onSearch: Function, initialValues: Object }
   */
  async function init(rootSelector, options = {}) {
    const root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
    if (!root) return;

    const airports = await window.FlightDataService.getAirports();

    // Elements inside this search instance
    const tripTabs = root.querySelectorAll('.ntb-trip-tab');
    const searchRow = root.querySelector('.ntb-search-row');
    const returnField = root.querySelector('.ntb-return-field');
    const swapBtn = root.querySelector('.ntb-swap-btn');
    const searchBtn = root.querySelector('.ntb-search-btn');
    const searchForm = root.querySelector('.ntb-search-form');
    const calendarMenu = root.querySelector('.ntb-calendar-menu');
    const departureField = root.querySelector('[data-date-type="departure"]');
    const departureInput = departureField?.querySelector('.ntb-date-input');
    const returnInput = returnField?.querySelector('.ntb-date-input');
    const paxPicker = root.querySelector('.ntb-pax-picker');

    // State for dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let dateStep = 'departure';
    let departureDate = null;
    let returnDate = null;

    // State for pax
    const paxCounts = { adult: 1, children: 0, infant: 0 };
    let travelClass = 'Economy';

    const dateKey = date => date ? date.toISOString().slice(0, 10) : '';
    const formatDate = date => date ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const sameDate = (a, b) => a && b && dateKey(a) === dateKey(b);

    // 1. Trip Tabs
    tripTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tripTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const isOneWay = tab.dataset.tab === 'oneway';
        if (returnField) returnField.style.display = isOneWay ? 'none' : '';
        if (searchRow) searchRow.classList.toggle('one-way', isOneWay);
      });
    });

    // 2. Airport Pickers
    root.querySelectorAll('.ntb-airport-picker').forEach(picker => {
      const input = picker.querySelector('.ntb-airport-input');
      const dropdown = picker.querySelector('.ntb-airport-dropdown');
      const selected = picker.querySelector('.ntb-airport-selected');
      const selectedCode = picker.querySelector('.ntb-airport-selected-code');
      const selectedName = picker.querySelector('.ntb-airport-selected-name');

      const selectAirport = (airport) => {
        input.value = airport.city;
        input.dataset.airportCode = airport.code;
        input.dataset.airportName = airport.name;
        if (selectedCode) selectedCode.textContent = airport.code;
        if (selectedName) selectedName.textContent = airport.name;
        picker.classList.add('has-selection');
        picker.classList.remove('is-editing', 'open');
        clearFieldError(picker.closest('.ntb-field'));
      };

      const renderDropdown = (query = '') => {
        const search = query.trim().toLowerCase();
        const matches = airports
          .filter(a => `${a.city} ${a.name} ${a.code}`.toLowerCase().includes(search))
          .slice(0, 8);

        dropdown.innerHTML = matches.length
          ? matches.map(a => `
              <button class="ntb-airport-option" type="button" data-code="${a.code}">
                <i class="bi bi-airplane"></i>
                <span><span class="ntb-airport-city">${a.city}</span><span class="ntb-airport-name">${a.name}</span></span>
                <span class="ntb-airport-code">${a.code}</span>
              </button>
            `).join('')
          : '<div class="ntb-airport-empty">No airports found. Try another city or code.</div>';

        dropdown.querySelectorAll('.ntb-airport-option').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const found = airports.find(a => a.code === btn.dataset.code);
            if (found) selectAirport(found);
          });
        });
      };

      input.addEventListener('focus', () => {
        picker.classList.add('is-editing');
      });

      input.addEventListener('input', () => {
        picker.classList.remove('has-selection');
        renderDropdown(input.value);
        picker.classList.add('open');
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') picker.classList.remove('open');
      });

      if (selected) {
        selected.addEventListener('click', () => {
          picker.classList.add('is-editing');
          renderDropdown(input.value);
          picker.classList.add('open');
          input.focus();
          input.select();
        });
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.ntb-airport-picker')) {
        root.querySelectorAll('.ntb-airport-picker').forEach(p => p.classList.remove('open', 'is-editing'));
      }
    });

    // 3. Swap Button
    if (swapBtn) {
      swapBtn.addEventListener('click', () => {
        const fromField = root.querySelector('.ntb-field-from');
        const toField = root.querySelector('.ntb-field-to');
        if (!fromField || !toField) return;

        const fromInput = fromField.querySelector('.ntb-airport-input');
        const toInput = toField.querySelector('.ntb-airport-input');
        const fromCodeEl = fromField.querySelector('.ntb-airport-selected-code');
        const toCodeEl = toField.querySelector('.ntb-airport-selected-code');
        const fromNameEl = fromField.querySelector('.ntb-airport-selected-name');
        const toNameEl = toField.querySelector('.ntb-airport-selected-name');

        // Swap values
        const tempVal = fromInput.value; fromInput.value = toInput.value; toInput.value = tempVal;
        const tempCode = fromInput.dataset.airportCode; fromInput.dataset.airportCode = toInput.dataset.airportCode; toInput.dataset.airportCode = tempCode;
        const tempName = fromInput.dataset.airportName; fromInput.dataset.airportName = toInput.dataset.airportName; toInput.dataset.airportName = tempName;

        const tempCodeText = fromCodeEl ? fromCodeEl.textContent : '';
        if (fromCodeEl && toCodeEl) { fromCodeEl.textContent = toCodeEl.textContent; toCodeEl.textContent = tempCodeText; }
        const tempNameText = fromNameEl ? fromNameEl.textContent : '';
        if (fromNameEl && toNameEl) { fromNameEl.textContent = toNameEl.textContent; toNameEl.textContent = tempNameText; }
      });
    }

    // 4. Two-Month Calendar Range Picker
    if (calendarMenu && departureInput) {
      const renderCalendar = () => {
        const months = [calendarMonth, new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)];
        const monthNames = months.map(m => m.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));

        calendarMenu.innerHTML = months.map((month, monthIndex) => {
          const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
          const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          const leadingDays = firstDay.getDay();
          const days = [];

          for (let i = 0; i < leadingDays; i++) days.push('<span></span>');

          for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(month.getFullYear(), month.getMonth(), day);
            const isPast = date < today;
            const isBeforeDeparture = dateStep === 'return' && departureDate && date <= departureDate;
            const isSelected = sameDate(date, departureDate) || sameDate(date, returnDate);
            const isInRange = departureDate && returnDate && date > departureDate && date < returnDate;

            const classes = [
              'ntb-calendar-day',
              isPast || isBeforeDeparture ? 'disabled' : '',
              isSelected ? 'selected' : '',
              isInRange ? 'in-range' : '',
              sameDate(date, departureDate) ? 'range-start' : '',
              sameDate(date, returnDate) ? 'range-end' : ''
            ].filter(Boolean).join(' ');

            days.push(`<button type="button" class="${classes}" data-date="${dateKey(date)}" ${isPast || isBeforeDeparture ? 'disabled' : ''}>${day}</button>`);
          }

          return `
            <div class="ntb-calendar-month">
              <div class="ntb-calendar-head">
                ${monthIndex === 0 ? '<button type="button" class="ntb-calendar-nav" data-calendar-nav="previous" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button>' : '<span></span>'}
                <span class="ntb-calendar-title">${monthNames[monthIndex]}</span>
                ${monthIndex === 1 ? '<button type="button" class="ntb-calendar-nav" data-calendar-nav="next" aria-label="Next month"><i class="bi bi-chevron-right"></i></button>' : '<span></span>'}
              </div>
              <div class="ntb-calendar-week"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
              <div class="ntb-calendar-days">${days.join('')}</div>
            </div>
          `;
        }).join('');

        // Month Navigation
        calendarMenu.querySelectorAll('[data-calendar-nav]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const direction = btn.dataset.calendarNav === 'next' ? 1 : -1;
            const nextMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + direction, 1);
            if (nextMonth >= new Date(today.getFullYear(), today.getMonth(), 1) || direction > 0) {
              calendarMonth = nextMonth;
              renderCalendar();
            }
          });
        });

        // Date Click
        calendarMenu.querySelectorAll('[data-date]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const picked = new Date(`${btn.dataset.date}T00:00:00`);
            const isOneWay = root.querySelector('.ntb-trip-tab.active')?.dataset.tab === 'oneway';

            if (isOneWay) {
              departureDate = picked;
              returnDate = null;
              departureInput.value = formatDate(departureDate);
              calendarMenu.classList.remove('open');
              clearFieldError(departureField);
            } else {
              if (dateStep === 'departure' || (departureDate && returnDate)) {
                departureDate = picked;
                returnDate = null;
                dateStep = 'return';
                departureInput.value = formatDate(departureDate);
                if (returnInput) returnInput.value = '';
                clearFieldError(departureField);
              } else {
                if (picked < departureDate) {
                  departureDate = picked;
                  departureInput.value = formatDate(departureDate);
                  clearFieldError(departureField);
                } else {
                  returnDate = picked;
                  if (returnInput) returnInput.value = formatDate(returnDate);
                  dateStep = 'departure';
                  calendarMenu.classList.remove('open');
                  if (returnField) clearFieldError(returnField);
                }
              }
            }
            renderCalendar();
          });
        });
      };

      const openCalendar = (type) => {
        dateStep = type;
        calendarMenu.classList.add('open');
        renderCalendar();
      };

      root.querySelectorAll('.ntb-date-picker').forEach(picker => {
        picker.addEventListener('click', (e) => {
          e.stopPropagation();
          openCalendar(picker.dataset.dateType);
        });
      });

      calendarMenu.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => calendarMenu.classList.remove('open'));
    }

    // 5. Travellers & Travel Class Picker
    if (paxPicker) {
      const paxDisplay = paxPicker.querySelector('.ntb-pax-display');

      const updatePax = () => {
        const parts = [];
        if (paxCounts.adult) parts.push(`${paxCounts.adult} Adult${paxCounts.adult > 1 ? 's' : ''}`);
        if (paxCounts.children) parts.push(`${paxCounts.children} Child${paxCounts.children > 1 ? 'ren' : ''}`);
        if (paxCounts.infant) parts.push(`${paxCounts.infant} Infant${paxCounts.infant > 1 ? 's' : ''}`);
        if (paxDisplay) paxDisplay.textContent = `${parts.join(' · ')} · ${travelClass}`;

        Object.entries(paxCounts).forEach(([type, count]) => {
          const counterEl = paxPicker.querySelector(`[data-pax-count="${type}"]`);
          if (counterEl) counterEl.textContent = count;
        });
      };

      if (paxDisplay) {
        paxDisplay.addEventListener('click', (e) => {
          e.stopPropagation();
          paxPicker.classList.toggle('open');
        });
      }

      paxPicker.querySelectorAll('[data-pax-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const type = btn.dataset.paxType;
          if (btn.dataset.paxAction === 'increase') {
            if (type === 'adult' || paxCounts[type] < 8) paxCounts[type] += 1;
          } else if (paxCounts[type] > (type === 'adult' ? 1 : 0)) {
            paxCounts[type] -= 1;
          }
          updatePax();
        });
      });

      paxPicker.querySelectorAll('[data-class]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          paxPicker.querySelectorAll('[data-class]').forEach(i => i.classList.remove('active'));
          btn.classList.add('active');
          travelClass = btn.dataset.class;
          updatePax();
        });
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('.ntb-pax-picker')) paxPicker.classList.remove('open');
      });
    }

    // 6. Validation helpers
    function clearFieldError(field) {
      if (!field) return;
      field.classList.remove('has-error');
      const err = field.querySelector('.ntb-field-error');
      if (err) err.textContent = '';
    }

    function showFieldError(field, message) {
      if (!field) return;
      field.classList.add('has-error');
      const err = field.querySelector('.ntb-field-error');
      if (err) err.textContent = message;
    }

    root.querySelectorAll('.ntb-search-row > .ntb-field').forEach(f => {
      f.addEventListener('input', () => clearFieldError(f));
      f.addEventListener('click', () => {
        if (f.classList.contains('has-error')) clearFieldError(f);
      });
    });

    // 7. Search Action
    if (searchBtn) {
      searchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const fromField = root.querySelector('.ntb-field-from');
        const toField = root.querySelector('.ntb-field-to');
        const isOneWay = root.querySelector('.ntb-trip-tab.active')?.dataset.tab === 'oneway';

        const fromInput = fromField?.querySelector('.ntb-airport-input');
        const toInput = toField?.querySelector('.ntb-airport-input');

        const fromVal = fromInput?.value || '';
        const toVal = toInput?.value || '';
        const depVal = departureInput?.value || '';
        const retVal = returnInput?.value || '';

        // ✅ Airport codes nikaalo
        const fromCode = fromInput?.dataset.airportCode || '';
        const toCode = toInput?.dataset.airportCode || '';

        const fields = [
          { field: fromField, value: fromVal, message: 'Choose a departure airport' },
          { field: toField, value: toVal, message: 'Choose a destination airport' },
          { field: departureField, value: depVal, message: 'Select a departure date' }
        ];

        if (!isOneWay) {
          fields.push({ field: returnField, value: retVal, message: 'Select a return date' });
        }

        root.querySelectorAll('.ntb-search-row > .ntb-field').forEach(clearFieldError);
        const invalids = fields.filter(f => !f.value.trim());

        if (invalids.length > 0) {
          invalids.forEach(item => showFieldError(item.field, item.message));
          invalids[0].field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const input = invalids[0].field.querySelector('input');
          if (input) input.focus();
          return;
        }

        // ✅ URL params me fromCode/toCode bhi bhejo
        const params = new URLSearchParams({
          from: fromVal,
          fromCode: fromCode,
          to: toVal,
          toCode: toCode,
          departure: depVal,
          return: isOneWay ? '' : retVal,
          trip: isOneWay ? 'oneway' : 'roundtrip',
          adults: paxCounts.adult,
          class: travelClass
        });

        if (typeof options.onSearch === 'function') {
          options.onSearch(params);
        } else {
          window.location.href = `results.html?${params.toString()}`;
        }
      });
    }

    // ✅ Initialize with default or passed values — CODES BHI SET KARO
    if (options.initialValues) {
      const init = options.initialValues;
      const fromInput = root.querySelector('.ntb-field-from .ntb-airport-input');
      const toInput = root.querySelector('.ntb-field-to .ntb-airport-input');
      const fromCodeEl = root.querySelector('.ntb-field-from .ntb-airport-selected-code');
      const toCodeEl = root.querySelector('.ntb-field-to .ntb-airport-selected-code');
      const fromNameEl = root.querySelector('.ntb-field-from .ntb-airport-selected-name');
      const toNameEl = root.querySelector('.ntb-field-to .ntb-airport-selected-name');

      if (init.from && fromInput) {
        fromInput.value = init.from;
        if (init.fromCode) {
          fromInput.dataset.airportCode = init.fromCode;
          if (fromCodeEl) fromCodeEl.textContent = init.fromCode;
          // Airport name bhi dhundho
          const ap = airports.find(a => a.code === init.fromCode);
          if (ap && fromNameEl) fromNameEl.textContent = ap.name;
          // has-selection class add karo
          const picker = fromInput.closest('.ntb-airport-picker');
          if (picker) picker.classList.add('has-selection');
        }
      }
      if (init.to && toInput) {
        toInput.value = init.to;
        if (init.toCode) {
          toInput.dataset.airportCode = init.toCode;
          if (toCodeEl) toCodeEl.textContent = init.toCode;
          const ap = airports.find(a => a.code === init.toCode);
          if (ap && toNameEl) toNameEl.textContent = ap.name;
          const picker = toInput.closest('.ntb-airport-picker');
          if (picker) picker.classList.add('has-selection');
        }
      }
      if (init.departure && departureInput) departureInput.value = init.departure;
      if (init.return && returnInput) returnInput.value = init.return;

      // Trip type set karo
      if (init.trip === 'oneway') {
        const oneWayTab = root.querySelector('.ntb-trip-tab[data-tab="oneway"]');
        if (oneWayTab) {
          tripTabs.forEach(t => t.classList.remove('active'));
          oneWayTab.classList.add('active');
          if (returnField) returnField.style.display = 'none';
          if (searchRow) searchRow.classList.add('one-way');
        }
      }
    }
  }

  return { init };
})();

window.FlightSearchForm = FlightSearchForm;