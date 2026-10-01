// Quick self-checks for server.js pure logic (no network calls).
// Run with: npm test
const assert = require('assert');
const s = require('../server.js');

const { parseSearchQuery, toSiteCityDate, toFlightClass, formatDuration, getDeparturePeriod,
        buildAeroSearchEnvelope, extractResult, mapFlights, xmlParser } = s;

// --- date conversion ---
assert.strictEqual(toSiteCityDate('2026-06-07'), '07.06.2026');
assert.strictEqual(toSiteCityDate('07.06.2026'), '07.06.2026');
assert.strictEqual(toSiteCityDate(''), null);
console.log('OK toSiteCityDate');

// --- cabin mapping ---
assert.strictEqual(toFlightClass('Economy'), 'Econom');
assert.strictEqual(toFlightClass('Business'), 'Business');
assert.strictEqual(toFlightClass('Premium Economy'), 'PremiumEconom');
assert.strictEqual(toFlightClass('First Class'), 'First');
assert.strictEqual(toFlightClass(undefined), 'Econom');
console.log('OK toFlightClass');

// --- duration ---
assert.strictEqual(formatDuration(250), '4h 10m');
assert.strictEqual(formatDuration(60), '1h');
assert.strictEqual(formatDuration(45), '45m');
assert.strictEqual(formatDuration(0), '--');
console.log('OK formatDuration');

// --- departure period ---
assert.strictEqual(getDeparturePeriod('00:30'), 'night');
assert.strictEqual(getDeparturePeriod('06:15'), 'early-morning');
assert.strictEqual(getDeparturePeriod('09:00'), 'morning');
assert.strictEqual(getDeparturePeriod('14:00'), 'afternoon');
assert.strictEqual(getDeparturePeriod('19:00'), 'evening');
assert.strictEqual(getDeparturePeriod('22:30'), 'night');
console.log('OK getDeparturePeriod');

// --- query validation ---
assert.ok(parseSearchQuery({ from: 'DEL', to: 'JFK' }).error, 'missing departure should error');
assert.ok(parseSearchQuery({ from: 'DE', to: 'JFK', departure: '2026-06-07' }).error, 'bad IATA should error');
assert.ok(parseSearchQuery({ from: 'DEL', to: 'JFK', departure: 'bogus' }).error, 'bad date should error');
assert.ok(parseSearchQuery({ from: 'DEL', to: 'JFK', departure: '2026-06-07', cabin: 'Nope' }).error, 'bad cabin should error');

const rt = parseSearchQuery({
  from: 'led', to: 'bak', departure: '2026-06-07', return: '2026-06-15', adults: '2', children: '1', infants: '1', cabin: 'Premium Economy'
});
assert.ok(!rt.error, 'valid roundtrip should parse');
assert.strictEqual(rt.value.outbound.from, 'LED');
assert.strictEqual(rt.value.outbound.date, '07.06.2026');
assert.strictEqual(rt.value.inbound.from, 'BAK', 'inbound must be reversed');
assert.strictEqual(rt.value.inbound.to, 'LED');
assert.strictEqual(rt.value.inbound.date, '15.06.2026');
assert.strictEqual(rt.value.adults, 2);
assert.strictEqual(rt.value.children, 1);
assert.strictEqual(rt.value.infants, 1);
assert.strictEqual(rt.value.flightClass, 'PremiumEconom');
console.log('OK parseSearchQuery');

const ow = parseSearchQuery({ from: 'LED', to: 'BAK', departure: '2026-06-07' });
assert.strictEqual(ow.value.inbound, null, 'one-way must have no inbound leg');
assert.strictEqual(ow.value.adults, 1, 'adults default 1');
console.log('OK parseSearchQuery one-way');

// --- envelope shape ---
const env = buildAeroSearchEnvelope(rt.value);
assert.ok(env.includes('action') === false, 'envelope must not contain the action attr');
assert.ok(env.includes('<AeroSearch xmlns="http://tempuri.org/">'), 'AeroSearch must be in tempuri ns');
assert.ok(env.includes('<credentials xmlns:a="http://schemas.datacontract.org/2004/07/SiteCity.Common"'), 'credentials must be UNQUALIFIED with local ns decl');
assert.ok(!env.includes('<a:credentials'), 'credentials must NOT be prefixed');
assert.ok(env.includes('<a:ApiLogin>test</a:ApiLogin>'), 'ApiLogin prefixed');
assert.ok(env.includes('<a:AuthExtendedData i:nil="true"/>'), 'AuthExtendedData nil required');
assert.ok(env.includes('<aeroSearchParams xmlns:a="http://schemas.datacontract.org/2004/07/SiteCity.Avia.Search"'), 'params unqualified');
assert.ok(env.includes('<a:FlightClass>PremiumEconom</a:FlightClass>'), 'FlightClass enum');
assert.ok(env.includes('<a:IATAFrom>LED</a:IATAFrom>') && env.includes('<a:IATATo>BAK</a:IATATo>'), 'outbound route');
assert.ok(env.includes('<a:IATAFrom>BAK</a:IATAFrom>') && env.includes('<a:IATATo>LED</a:IATATo>'), 'inbound route');
assert.strictEqual((env.match(/<a:SearchFlight>/g) || []).length, 2, 'roundtrip has 2 SearchFlight rows');
const envOne = buildAeroSearchEnvelope(ow.value);
assert.strictEqual((envOne.match(/<a:SearchFlight>/g) || []).length, 1, 'one-way has 1 SearchFlight row');
console.log('OK buildAeroSearchEnvelope');

// --- SOAP fault extraction ---
const faultXml = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Code><s:Value>s:Sender</s:Value></s:Code><s:Reason><s:Text xml:lang="ru-RU">authInfo is null</s:Text></s:Reason><s:Detail><GenericException xmlns="http://schemas.datacontract.org/2004/07/Interfaces"><Code>-1</Code><Description>authInfo is null</Description><Lang>en</Lang></GenericException></s:Detail></s:Fault></s:Body></s:Envelope>`;
const f = extractResult(xmlParser.parse(faultXml));
assert.ok(f.fault, 'fault must be detected');
assert.strictEqual(f.result, null);
console.log('  fault reason:', f.fault.reason, '| code:', f.fault.code);

// --- Success=false mapping ---
const failXml = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><AeroSearchResponse xmlns="http://tempuri.org/"><AeroSearchResult xmlns:a="http://schemas.datacontract.org/2004/07/SiteCity.Avia.Search"><Currency xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">EUR</Currency><ErrorCode xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">1000</ErrorCode><ErrorString xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">Error in the date of departure</ErrorString><Success xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">false</Success><a:FlightData i:nil="true"/><a:ResultCount>0</a:ResultCount></AeroSearchResult></AeroSearchResponse></s:Body></s:Envelope>`;
const r2 = extractResult(xmlParser.parse(failXml));
assert.ok(r2.result, 'result must be found');
assert.strictEqual(String(r2.result.Success), 'false');
assert.strictEqual(String(r2.result.ErrorCode), '1000');
assert.strictEqual(String(r2.result.ErrorString), 'Error in the date of departure');
console.log('OK extractResult (Success=false)');

// ---------------------------------------------------------------------------
// AeroPrebook / AeroBook (offline: envelope shape + response mapping)
// ---------------------------------------------------------------------------

// Envelope: wrapper unqualified, children prefixed, both required fields present.
const preEnv = s.buildAeroPrebookEnvelope({ offerCode: 'OFFER123', searchGuid: 'guid-abc' });
assert.ok(preEnv.includes('<AeroPrebook xmlns="http://tempuri.org/">'), 'AeroPrebook wrapper in tempuri ns');
assert.ok(preEnv.includes('<aeroPrebookParams xmlns:a="http://schemas.datacontract.org/2004/07/SiteCity.Avia.Prebook"'), 'params unqualified with local ns');
assert.ok(preEnv.includes('<a:OfferCode>OFFER123</a:OfferCode>'), 'OfferCode present');
assert.ok(preEnv.includes('<a:SearchGuid>guid-abc</a:SearchGuid>'), 'SearchGuid present');
assert.ok(preEnv.includes('<a:AuthExtendedData i:nil="true"/>'), 'AuthExtendedData nil required');
console.log('OK buildAeroPrebookEnvelope');

// Envelope: services/tariffs blocks only appear when selections exist.
const bookEnv = s.buildAeroBookEnvelope({
  offerCode: 'OFFER123',
  searchGuid: 'guid-abc',
  paxList: [{ ageType: 'Adult', genderType: 'Male', name: 'Test', middleName: '', surname: 'Traveller', birthDay: '04.05.1990' }],
  selectedEmd: [{ id: 121, rph: 1, quantity: 2 }],
  selectedServices: [{ id: 22, rph: 1 }],
  selectedTariffs: [7],
  email: 'a@b.com',
  phone: '+911234567890',
  customerFio: 'Test Traveller',
  userTimeZone: 0
});
assert.ok(bookEnv.includes('<AeroBook xmlns="http://tempuri.org/">'), 'AeroBook wrapper');
assert.ok(bookEnv.includes('<a:PaxData>'), 'pax row');
assert.ok(bookEnv.includes('<a:Name>Test</a:Name>'), 'pax name');
assert.ok(bookEnv.includes('<a:MiddleName></a:MiddleName>'), 'middle name must be emitted (LatNames)');
assert.ok(bookEnv.includes('<a:Surname>Traveller</a:Surname>'), 'pax surname');
assert.ok(bookEnv.includes('<a:AgeType>Adult</a:AgeType>'), 'AgeType enum');
assert.ok(bookEnv.includes('<a:GenderType>Male</a:GenderType>'), 'GenderType enum');
assert.ok(bookEnv.includes('<a:Id>121</a:Id>') && bookEnv.includes('<a:Quantity>2</a:Quantity>'), 'SelectedEmd id + quantity');
assert.ok(bookEnv.includes('<a:Id>22</a:Id>'), 'SelectedService id');
assert.ok(bookEnv.includes('<a:int>7</a:int>'), 'SelectedTariffs int');
assert.ok(bookEnv.includes('<a:Email>a@b.com</a:Email>'), 'email');

// No selections -> the optional wrappers must be omitted entirely.
const bareEnv = s.buildAeroBookEnvelope({
  offerCode: 'O', searchGuid: 'g',
  paxList: [{ name: 'A', surname: 'B' }],
  selectedEmd: [], selectedServices: [], selectedTariffs: [],
  email: 'a@b.com', phone: '1'
});
assert.ok(!bareEnv.includes('<a:SelectedEmd>'), 'empty SelectedEmd must be omitted');
assert.ok(!bareEnv.includes('<a:SelectedServices>'), 'empty SelectedServices must be omitted');
assert.ok(!bareEnv.includes('<a:SelectedTariffs>'), 'empty SelectedTariffs must be omitted');
console.log('OK buildAeroBookEnvelope');

// XML escaping of user input (no tag injection).
const escEnv = s.buildAeroBookEnvelope({
  offerCode: 'O', searchGuid: 'g',
  paxList: [{ name: '<script>x</script>', surname: 'A&B' }],
  email: 'a@b.com', phone: '1'
});
assert.ok(!escEnv.includes('<script>'), 'user input must be escaped');
assert.ok(escEnv.includes('&lt;script&gt;'), 'escaped name present');
assert.ok(escEnv.includes('A&amp;B'), 'ampersand escaped');
console.log('OK XML escaping');

// AeroPrebook response mapping (shape taken from a real captured response).
const preXml = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><AeroPrebookResponse xmlns="http://tempuri.org/"><AeroPrebookResult xmlns:a="http://schemas.datacontract.org/2004/07/SiteCity.Avia.Prebook"><Currency xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">EUR</Currency><Success xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">true</Success><a:DocumentsRequired>true</a:DocumentsRequired><a:Emd><a:ServiceInfo><a:Id>121</a:Id><a:Name>Seat selection</a:Name><a:Price>11.15</a:Price><a:Rph>1</a:Rph><a:Type>EmdSeat</a:Type><a:FlightNum>J2-20</a:FlightNum></a:ServiceInfo></a:Emd><a:FullPrice>295.38</a:FullPrice><a:LatNames>true</a:LatNames><a:Services><a:ServiceInfo><a:Id>31</a:Id><a:Name>No insurance</a:Name><a:Price>0</a:Price><a:Type>Insurance</a:Type></a:ServiceInfo></a:Services></AeroPrebookResult></AeroPrebookResponse></s:Body></s:Envelope>`;
const preResult = extractResult(xmlParser.parse(preXml), 'AeroPrebook').result;
assert.ok(preResult, 'AeroPrebookResult must be extracted');
assert.strictEqual(String(preResult.FullPrice), '295.38');

const mapped = s.mapPrebook(preResult);
assert.strictEqual(mapped.providerCurrency, 'EUR');
assert.strictEqual(mapped.latNames, true);
assert.strictEqual(mapped.documentsRequired, true);
assert.strictEqual(mapped.services.length, 1, 'one insurance service');
assert.strictEqual(mapped.services[0].type, 'Insurance');
assert.strictEqual(mapped.services[0].priceProvider, 0);
assert.strictEqual(mapped.emd.length, 1, 'one seat option');
assert.strictEqual(mapped.emd[0].id, 121);
assert.strictEqual(mapped.emd[0].rph, 1);
assert.strictEqual(mapped.allServices.length, 2, 'allServices unions services + emd');
// Prices are converted into the frontend base currency, provider amount kept.
assert.strictEqual(mapped.fullPrice, s.toBaseCurrency(295.38, 'EUR'));
assert.strictEqual(mapped.fullPriceProvider, 295.38);
console.log('OK mapPrebook');

// AeroBook response mapping.
const bookXml = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><AeroBookResponse xmlns="http://tempuri.org/"><AeroBookResult xmlns:a="http://schemas.datacontract.org/2004/07/SiteCity.Avia.Booking"><Currency xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">EUR</Currency><Success xmlns="http://schemas.datacontract.org/2004/07/SiteCity.Common">true</Success><a:BookGuid>11111111-2222-3333-4444-555555555555</a:BookGuid><a:BookId>98765</a:BookId><a:FullPrice>295.38</a:FullPrice><a:PaymentUrl>https://pay.example/abc</a:PaymentUrl></AeroBookResult></AeroBookResponse></s:Body></s:Envelope>`;
const bookResult = extractResult(xmlParser.parse(bookXml), 'AeroBook').result;
assert.ok(bookResult, 'AeroBookResult must be extracted');
const mappedBook = s.mapBook(bookResult);
assert.strictEqual(mappedBook.bookId, 98765);
assert.strictEqual(mappedBook.bookGuid, '11111111-2222-3333-4444-555555555555');
assert.strictEqual(mappedBook.paymentUrl, 'https://pay.example/abc');
assert.strictEqual(mappedBook.fullPriceProvider, 295.38);
console.log('OK mapBook');

// The generic extractor must not confuse the two response types.
assert.strictEqual(extractResult(xmlParser.parse(preXml), 'AeroBook').result, null,
  'prebook payload must not resolve as AeroBook');
assert.strictEqual(extractResult(xmlParser.parse(bookXml), 'AeroPrebook').result, null,
  'book payload must not resolve as AeroPrebook');
console.log('OK extractResult per-method isolation');

console.log('\nAll self-checks passed.');
