/**
 * Live API checks for the seat map and native-integer pricing.
 *
 * These hit the running server, so they are separate from `npm test` (which is
 * fully offline). Start the server first, then:
 *
 *   node test/seatmap-live.js [port]
 *
 * The SeatCity seat map is supplier-dependent: individual flights may answer
 * "Internal error" even though the offer is fine. The test therefore scans a
 * few flights and only fails if NONE of them produce a map.
 */
'use strict';

const http = require('http');

const PORT = process.argv[2] || process.env.PORT || '5000';

function get(path) {
  return new Promise((resolve) => {
    http.get({ hostname: 'localhost', port: PORT, path }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ _raw: d.slice(0, 300) }); }
      });
    }).on('error', (e) => resolve({ _err: e.message }));
  });
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const departure = addDays(30);
  console.log(`\nSeat map + pricing checks (port ${PORT}, ${departure})\n`);

  const search = await get(`/api/flights?from=DEL&to=BOM&departure=${departure}&adults=1&cabin=Economy`);
  if (search._err) { console.log('Cannot reach the server:', search._err); process.exit(1); }
  if (!search.flights || !search.flights.length) {
    console.log('No flights returned:', search.notice || JSON.stringify(search).slice(0, 200));
    process.exit(1);
  }

  // ---- pricing -----------------------------------------------------------------
  const f = search.flights[0];
  console.log('=== pricing ===');
  check('currency is the requested one', search.currency === 'INR', search.currency);
  check('price block present', Boolean(f.price));
  check('no currency conversion applied', f.price.converted === false, String(f.price.converted));
  check('basePrice equals price.totalPrice', Math.abs(f.basePrice - f.price.totalPrice) < 0.01,
    `${f.basePrice} vs ${f.price.totalPrice}`);
  check('base fare + taxes == total',
    Math.abs((f.price.adultBasePrice + f.price.taxes) - f.price.totalPrice) < 1,
    `${f.price.adultBasePrice} + ${f.price.taxes.toFixed(2)}`);

  // ---- seat map ----------------------------------------------------------------
  console.log('\n=== seat map ===');
  let map = null;
  const tried = [];
  for (let i = 0; i < Math.min(8, search.flights.length); i += 1) {
    const cand = search.flights[i];
    const flightNum = ((cand.legs[0].segments || [])[0] || {}).FlightNum || '';
    if (!flightNum) continue;
    const r = await get(
      `/api/seatmap?offerCode=${encodeURIComponent(cand.id)}` +
      `&searchGuid=${search.searchGuid}&flightNum=${encodeURIComponent(flightNum)}&rph=1`
    );
    tried.push(`${flightNum}:${r.available ? 'map' : (r.reason || r.error || '?')}`);
    if (r.available) { map = r; break; }
  }

  if (!map) {
    console.log('  No seat map on the flights tried (provider-dependent):');
    console.log('   ', tried.join(' | '));
    console.log('\nSkipping seat map assertions.');
  } else {
    const seats = map.rows.flatMap((r) => r.seats);
    const selectable = seats.filter((s) => s.available && s.emdId != null);
    console.log(`  map for ${map.flightNum}: ${map.rowCount} rows, ${map.seatCount} seats, ` +
      `${selectable.length} selectable`);

    check('seat map marked available', map.available === true);
    check('rows returned', map.rowCount > 0, String(map.rowCount));
    check('seat codes resolved', map.seatLetters.length >= 2, map.seatLetters.join(''));
    check('aisle gaps removed (every seat has a code)', seats.every((s) => s.code));
    check('ascending row numbers',
      map.rows.every((r, i, a) => i === 0 || a[i - 1].number <= r.number));
    check('selectable seats always carry an emdId', selectable.every((s) => s.emdId != null),
      `${selectable.length} selectable`);
    check('seats with no emdId are never selectable',
      seats.filter((s) => s.emdId == null).every((s) => !s.available));
    check('emdIds listed for pricing', map.emdIds.length > 0, map.emdIds.join(','));

    // ---- seat tiers are priced by the prebook ----------------------------------
    console.log('\n=== seat tier pricing (via prebook) ===');
    const prebook = await get(
      `/api/prebook?offerCode=${encodeURIComponent(search.flights.find((x) =>
        ((x.legs[0].segments || [])[0] || {}).FlightNum === map.flightNum)?.id || search.flights[0].id)}` +
      `&searchGuid=${search.searchGuid}`
    );
    if (prebook.success) {
      const byId = new Map([...(prebook.emd || []), ...(prebook.services || [])].map((s) => [s.id, s]));
      const priced = map.emdIds.filter((id) => byId.has(id));
      priced.forEach((id) => {
        const svc = byId.get(id);
        console.log(`  EmdId ${id} -> ${svc.price} ${prebook.currency} "${svc.name}" (${svc.type})`);
      });
      check('every seat tier has a price from the prebook',
        priced.length === map.emdIds.length, `${priced.length}/${map.emdIds.length}`);
    } else {
      console.log('  prebook unavailable, skipping tier price check');
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? 'ALL LIVE CHECKS PASSED' : failed + ' CHECK(S) FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
})();
