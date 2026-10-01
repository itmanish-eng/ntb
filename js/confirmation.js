/**
 * NOWTOBOOK — Booking confirmation
 *
 * Reads the result that js/data.js persisted after a successful POST /api/book
 * (sessionStorage, so it survives the redirect from booking.html without a
 * second provider call) and renders it. All values come from the AeroBook
 * response — nothing here is invented.
 */

const FlightConfirmation = (() => {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readStoredBooking() {
    try {
      const raw = sessionStorage.getItem('ntb_last_booking');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Ignore anything stale (older than an hour).
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.at && Date.now() - parsed.at > 60 * 60 * 1000) return null;
      return parsed;
    } catch (error) {
      console.warn('[confirmation] could not read the stored booking:', error.message);
      return null;
    }
  }

  function line(label, value) {
    if (value === undefined || value === null || value === '') return '';
    return `
      <div class="ntb-order-line">
        <span>${escapeHtml(label)}</span>
        <b>${escapeHtml(String(value))}</b>
      </div>
    `;
  }

  function init() {
    const stored = readStoredBooking();

    if (!stored) {
      $('confirmMissing').hidden = false;
      console.log('[confirmation] no stored booking');
      return;
    }

    if (stored.dryRun) {
      const req = stored.request || {};
      $('dryRunLines').innerHTML = [
        line('Status', 'Validated, not booked'),
        line('Travellers', req.paxCount),
        line('Seats / baggage options', (req.selectedEmd || []).length),
        line('Insurance options', (req.selectedServices || []).length),
        line('Fare options', (req.selectedTariffs || []).length)
      ].join('');
      $('confirmDryRun').hidden = false;
      console.log('[confirmation] dry-run result shown');
      return;
    }

    const b = stored.booking || {};
    $('confirmSubtitle').textContent =
      b.passedToSupplier
        ? 'Your booking has been passed to the airline.'
        : 'Your booking has been created with the provider.';

    if (b.bookId || b.bookGuid) {
      $('confirmRefValue').textContent = b.bookId ? String(b.bookId) : String(b.bookGuid);
      $('confirmRef').hidden = false;
    }

    const fmt = window.FlightDataService ? window.FlightDataService.formatPrice : (v) => String(v);
    $('realLines').innerHTML = [
      line('Booking reference', b.bookId || b.bookGuid),
      line('Total paid', b.fullPrice != null ? fmt(b.fullPrice) : ''),
      line('Quoted in', b.providerCurrency),
      b.confirmableTo ? line('Confirm before', b.confirmableTo) : '',
      b.paymentUrl ? `<div class="ntb-order-line">
          <span>Payment</span>
          <b><a href="${escapeHtml(b.paymentUrl)}" target="_blank" rel="noopener noreferrer">Complete payment</a></b>
        </div>` : ''
    ].join('');

    $('confirmReal').hidden = false;
    console.log('[confirmation] booking shown, reference:', b.bookId || b.bookGuid);
  }

  return { init };
})();

window.FlightConfirmation = FlightConfirmation;
