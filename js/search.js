/**
 * NOWTBOOK — Flight Search Form Controller
 * Reusable logic for Airport selection, Calendar date picker,
 * Passenger/Class selector, validation, and search submission.
 */

const FlightSearchForm = (() => {
  async function init(rootSelector, options = {}) {
    const root = typeof rootSelector === 'string' ? document.querySelector(rootSelector) : rootSelector;
    if (!root) return;

    const airports = await window.FlightDataService.getAirports();

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let dateStep = 'departure';
    let departureDate = null;
    let returnDate = null;

    const paxCounts = { adult: 1, children: 0, infant: 0 };
    let travelClass = 'Economy';

    // ✅ dateKey() local time use kare
    const dateKey = date => {
      if (!date) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

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

        // ✅ Date click — local time
        calendarMenu.querySelectorAll('[data-date]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const [y, m, d] = btn.dataset.date.split('-').map(Number);
            const picked = new Date(y, m - 1, d);
            picked.setHours(0, 0, 0, 0);

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

    // ============================================================
    // ✅ USER LOCATION SE NEARBY AIRPORT AUTO-FILL
    // ============================================================
    async function getUserCoords() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) {
          resolve(null);
          return;
        }
        const timeoutId = setTimeout(() => resolve(null), 5000);
        navigator.geolocation.getCurrentPosition(
          (position) => {
            clearTimeout(timeoutId);
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            });
          },
          () => {
            clearTimeout(timeoutId);
            resolve(null);
          },
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 600000 }
        );
      });
    }

    function getDistanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    // Major airports ke coordinates
    const AIRPORT_COORDS = {
      "DEL": [28.5562, 77.1000], "BOM": [19.0896, 72.8656],
      "BLR": [13.1986, 77.7066], "HYD": [17.2403, 78.4294],
      "MAA": [12.9941, 80.1709], "CCU": [22.6547, 88.4467],
      "GOX": [15.7440, 73.8630], "COK": [10.1520, 76.4019],
      "AMD": [23.0722, 72.6347], "PNQ": [18.5821, 73.9197],
      "DXB": [25.2532, 55.3657], "AUH": [24.4330, 54.6511],
      "DOH": [25.2731, 51.6080], "SIN": [1.3644, 103.9915],
      "BKK": [13.6900, 100.7501], "KUL": [2.7456, 101.7099],
      "HKG": [22.3080, 113.9185], "NRT": [35.7720, 140.3929],
      "ICN": [37.4602, 126.4407], "LHR": [51.4700, -0.4543],
      "CDG": [49.0097, 2.5479], "FRA": [50.0379, 8.5622],
      "AMS": [52.3105, 4.7683], "JFK": [40.6413, -73.7781],
      "LAX": [33.9416, -118.4085], "SFO": [37.6213, -122.3790],
      "ORD": [41.9742, -87.9073], "YYZ": [43.6777, -79.6248],
      "SYD": [-33.9399, 151.1753], "MEL": [-37.6690, 144.8410],
      "JNB": [-26.1392, 28.2460], "CAI": [30.1219, 31.4056],
      "IST": [41.2753, 28.7519], "MAD": [40.4983, -3.5676],
      "FCO": [41.8003, 12.2389], "ZRH": [47.4647, 8.5492],
      "VIE": [48.1103, 16.5697], "CPH": [55.6180, 12.6508],
      "DUB": [53.4213, -6.2701], "NBO": [-1.3192, 36.9278],
      "ADD": [8.9779, 38.7993], "CMN": [33.3675, -7.5899]
    };

    async function findNearestAirport(airportsList) {
      const coords = await getUserCoords();
      if (!coords) return null;

      const { latitude, longitude } = coords;
      let nearest = null;
      let minDist = Infinity;

      airportsList.forEach(ap => {
        const apCoords = AIRPORT_COORDS[ap.code];
        if (!apCoords) return;
        const dist = getDistanceKm(latitude, longitude, apCoords[0], apCoords[1]);
        if (dist < minDist) {
          minDist = dist;
          nearest = ap;
        }
      });

      return nearest;
    }

    // ============================================================
    // ✅ INITIAL / DEFAULT VALUES
    // ============================================================
    const init = options.initialValues || {};

    function applyAirportSelection(fieldSelector, city, code) {
      const field = root.querySelector(fieldSelector);
      if (!field) return;

      const input = field.querySelector('.ntb-airport-input');
      const picker = field.querySelector('.ntb-airport-picker');
      if (!input || !picker) return;

      const ap = (code && airports.find(a => a.code === code))
        || airports.find(a => a.city.toLowerCase() === (city || '').toLowerCase());
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

    // ✅ "From" — URL se ya user location se
    if (init.from) {
      applyAirportSelection('.ntb-field-from', init.from, init.fromCode);
    } else {
      const nearest = await findNearestAirport(airports);
      if (nearest) {
        applyAirportSelection('.ntb-field-from', nearest.city, nearest.code);
      } else {
        // Location allow nahi kiya → default Delhi
        applyAirportSelection('.ntb-field-from', 'New Delhi', 'DEL');
      }
    }

    // ✅ "To" — khaali chhodo (agar URL me nahi hai)
    if (init.to) {
      applyAirportSelection('.ntb-field-to', init.to, init.toCode);
    }

    // ✅ Departure date — URL se ya aaj ki date
    if (init.departure && departureInput) {
      departureInput.value = init.departure;
      const d = new Date(init.departure);
      if (!isNaN(d)) departureDate = d;
    } else if (departureInput && !departureInput.value) {
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      departureDate = todayDate;
      departureInput.value = formatDate(todayDate);
    }

    // ✅ Return date — URL se ya aaj se 7 din baad
    if (init.return && returnInput) {
      returnInput.value = init.return;
      const d = new Date(init.return);
      if (!isNaN(d)) returnDate = d;
    } else if (returnInput && !returnInput.value) {
      const isOneWay = root.querySelector('.ntb-trip-tab.active')?.dataset.tab === 'oneway';
      if (!isOneWay) {
        const defaultReturn = new Date();
        defaultReturn.setDate(defaultReturn.getDate() + 7);
        defaultReturn.setHours(0, 0, 0, 0);
        returnDate = defaultReturn;
        returnInput.value = formatDate(defaultReturn);
      }
    }

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

  return { init };
})();

window.FlightSearchForm = FlightSearchForm;