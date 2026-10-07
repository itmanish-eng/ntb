/**
 * NOWTOBOOK — SiteCity SOAP API backend proxy
 * ===========================================
 *
 * Purpose
 * -------
 * The frontend (js/data.js) calls this Express server over plain JSON.
 * This server converts that JSON search request into a SOAP 1.2 XML request
 * for the SiteCity `AeroSearch` method, sends it to the SiteCity endpoint,
 * parses the SOAP XML response and returns JSON shaped exactly like the
 * existing `data/flights.json` records that js/results.js already understands.
 *
 *    GET /api/health
 *    GET /api/flights?from=LED&to=BAK&departure=2026-06-07&return=2026-06-15&adults=1&cabin=Economy
 *
 * CommonJS on purpose (require, not import).
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

/**
 * The frontend's airport dataset, used to fill in names the provider omits.
 * Loaded once; a missing file just means we fall back to IATA codes.
 */
const LOCAL_AIRPORTS = (() => {
  try {
    const file = path.join(__dirname, '..', 'data', 'airports.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`[airports] could not load data/airports.json: ${error.message}`);
    return [];
  }
})();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG = {
  port: Number(process.env.PORT || 5000),
  siteCityUrl: process.env.SITECITY_URL || 'http://test-api.xml.agency/SiteCity',
  apiLogin: process.env.API_LOGIN || 'test',
  apiPassword: process.env.API_PASSWORD || 'test',
  tokenGuid: process.env.TOKEN_GUID || '00000000-0000-0000-0000-000000000000',
  deviceId: process.env.DEVICE_ID || 'test',
  currency: process.env.CURRENCY || 'EUR',
  language: process.env.LANGUAGE || 'EN',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),

  // The frontend's price formatter (js/data.js -> formatPrice) treats every
  // basePrice as INR, so amounts coming back from SiteCity are converted into
  // the base currency here. Set PRICE_CONVERSION_ENABLED=false to return the
  // provider amount untouched.
  priceConversionEnabled: String(process.env.PRICE_CONVERSION_ENABLED || 'true') !== 'false',
  baseCurrency: process.env.BASE_CURRENCY || 'INR',
  sourceCurrencyRate: Number(process.env.SOURCE_CURRENCY_RATE || 106), // 1 EUR = 106 INR

  // AeroBook creates a REAL booking on the provider. While true, POST /api/book
  // validates the request and returns the exact SOAP payload it WOULD send
  // without transmitting it, so nothing is booked by accident.
  bookDryRun: String(process.env.BOOK_DRY_RUN || 'true') !== 'false'
};

// SOAP / data-contract namespaces (verified against the live WSDL + XSDs).
const NS = {
  soap12: 'http://www.w3.org/2003/05/soap-envelope',
  tempuri: 'http://tempuri.org/',
  common: 'http://schemas.datacontract.org/2004/07/SiteCity.Common',
  search: 'http://schemas.datacontract.org/2004/07/SiteCity.Avia.Search',
  prebook: 'http://schemas.datacontract.org/2004/07/SiteCity.Avia.Prebook',
  booking: 'http://schemas.datacontract.org/2004/07/SiteCity.Avia.Booking',
  seatmap: 'http://schemas.datacontract.org/2004/07/SiteCity.Avia.SeatMap',
  arrays: 'http://schemas.microsoft.com/2003/10/Serialization/Arrays',
  instance: 'http://www.w3.org/2001/XMLSchema-instance'
};

const SOAP_ACTION = 'http://tempuri.org/ISiteAvia/AeroSearch';
const SOAP_ACTIONS = {
  AeroSearch: 'http://tempuri.org/ISiteAvia/AeroSearch',
  AeroPrebook: 'http://tempuri.org/ISiteAvia/AeroPrebook',
  AeroBook: 'http://tempuri.org/ISiteAvia/AeroBook',
  AeroSeatMap: 'http://tempuri.org/ISiteAvia/AeroSeatMap'
};

/** Frontend cabin label -> SiteCity `FlightClass` enum value. */
const CABIN_MAP = {
  economy: 'Econom',
  business: 'Business',
  'premium economy': 'PremiumEconom',
  premiumeconomy: 'PremiumEconom',
  premium: 'PremiumEconom',
  'first class': 'First',
  first: 'First'
};

/**
 * fast-xml-parser config.
 *
 * NOTE: this endpoint returns SOAP-encoded (not SOAP 1.2) namespaces and
 * repeated elements throughout, so collections are forced to arrays.
 * `removeNSPrefix` strips the `a:` / `b:` / `s:` prefixes so `a:AirCompany`
 * becomes `AirCompany`.
 *
 * `isArrayAsTagName: true` is important: the array wrapper and the repeated
 * item share the same name (`<a:FlightData><a:FlightData>...`), so matching on
 * the node's own keys would also turn the wrapper into an array and produce a
 * nested `[[...]]`. Matching the tag name keeps the wrapper a plain object.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArrayAsTagName: true,
  isArray: (name) =>
    ['FlightData', 'OfferInfo', 'OfferSegment', 'CodeValue', 'AirPortInfo'].includes(name)
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** XML-escape a value before embedding it in the SOAP envelope. */
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert a provider amount into the currency the frontend treats as base.
 *
 * js/data.js -> formatPrice() assumes every `basePrice` is already INR, so a
 * raw EUR amount from SiteCity would be rendered as if it were rupees.
 * Disable with PRICE_CONVERSION_ENABLED=false.
 */
function toBaseCurrency(amount, providerCurrency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  if (!CONFIG.priceConversionEnabled) return value;

  const from = String(providerCurrency || CONFIG.currency).toUpperCase();
  if (from === String(CONFIG.baseCurrency).toUpperCase()) return value;

  return Math.round(value * CONFIG.sourceCurrencyRate);
}

/**
 * Convert a frontend date to the SiteCity `DD.MM.YYYY` format.
 * Accepts `YYYY-MM-DD` (the format js/search.js puts in the URL) and also
 * tolerates an already-converted `DD.MM.YYYY` string.
 */
function toSiteCityDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Already DD.MM.YYYY
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;

  // YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;

  // Anything else Date can parse
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getUTCFullYear()}`;
  }

  return null;
}

/** Map a frontend cabin label to the SiteCity FlightClass enum. */
function toFlightClass(cabin) {
  const key = String(cabin || 'Economy').trim().toLowerCase();
  return CABIN_MAP[key] || 'Econom';
}

/** Parse "31.10.2026 00:30" -> { date: '31.10.2026', time: '00:30' } */
function splitDateTime(value) {
  const raw = String(value == null ? '' : value).trim();
  const m = raw.match(/^(\d{2}\.\d{2}\.\d{4})\s*(\d{2}:\d{2})?/);
  if (m) return { date: m[1], time: m[2] || '--:--' };
  const t = raw.match(/(\d{2}:\d{2})/);
  return { date: null, time: t ? t[1] : '--:--' };
}

/** 250 -> "4h 10m" */
function formatDuration(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return '--';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Time-of-day bucket used by the results page departure-time filter.
 * Mirrors the vocabulary already present in data/flights.json.
 */
function getDeparturePeriod(time) {
  const m = String(time || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 'morning';
  const hour = Number(m[1]);
  if (hour < 5) return 'night';
  if (hour < 8) return 'early-morning';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * Normalise a value that fast-xml-parser may hand back.
 * With `ignoreAttributes: false`, an element that carries attributes parses
 * to an object such as `{ '#text': 'authInfo is null', '@_xml:lang': 'ru-RU' }`,
 * and an empty element parses to `false`/`''`. Always return a string.
 */
function textOf(node) {
  if (node === undefined || node === null || node === false) return '';
  if (typeof node === 'object') {
    if (typeof node['#text'] !== 'undefined') return String(node['#text']).trim();
    return '';
  }
  return String(node).trim();
}

/** Always return an array for a possibly-single value. */
function asArray(value) {
  if (value === undefined || value === null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Unwrap a WCF array wrapper.
 *
 * The wire shape repeats the element name:
 *   <a:FlightData><a:FlightData>...</a:FlightData>...469...</a:FlightData>
 * and fast-xml-parser (with `isArrayAsTagName: true`) yields:
 *   result.FlightData           -> [ { FlightData: [ ...469 items... ] } ]
 *   fd.Offers                   -> { OfferInfo: [ ... ] }
 *   offer.Segments              -> { OfferSegment: [ ... ] }
 *
 * So the wrapper may be either an array holding the real container, or the
 * container itself; both are handled here.
 */
function collection(container, key) {
  if (container === undefined || container === null || container === false) return [];

  // Wrapper array: unwrap the single container element it holds.
  let node = container;
  if (Array.isArray(node)) {
    if (node.length === 0) return [];
    if (node.length === 1) {
      if (Array.isArray(node[0])) return node[0]; // already the item array
      node = node[0];
    } else {
      return node; // already the item array
    }
  }

  if (!node || typeof node !== 'object') return [];

  const value = node[key];
  if (value === undefined || value === null || value === false) return [];
  if (!Array.isArray(value)) return [value];

  // A single-element wrapper around another array (older parser settings).
  if (value.length === 1 && Array.isArray(value[0])) return value[0];

  return value;
}

// ---------------------------------------------------------------------------
// SOAP request builder
// ---------------------------------------------------------------------------

/**
 * Build the SOAP 1.2 AeroSearch envelope.
 *
 * IMPORTANT (learned the hard way against the live service):
 *  - `credentials` / `aeroSearchParams` must be in the EMPTY namespace
 *    (unqualified element names) while their children are namespace-qualified
 *    via a locally declared `a:` prefix. Declaring the child namespace on the
 *    envelope makes the service report "authInfo is null".
 *  - Submitting `<a:AuthExtendedData i:nil="true"/>` is what the official
 *    documentation shows, and it is what makes the service accept the call.
 *  - `FlightClass` uses the WCF enum spellings: Econom / Business /
 *    PremiumEconom / First (NOT "Economy" / "Premium Economy").
 *
 * @param {{outbound:{from:string,to:string,date:string},
 *          inbound:?{from:string,to:string,date:string},
 *          adults:number, children:number, infants:number,
 *          flightClass:string}} req
 * @returns {string} SOAP XML envelope
 */
function buildAeroSearchEnvelope(req) {
  const flightRows = [req.outbound, req.inbound]
    .filter(Boolean)
    .map(
      (leg) => `                    <a:SearchFlight>
                        <a:Date>${escapeXml(leg.date)}</a:Date>
                        <a:IATAFrom>${escapeXml(leg.from)}</a:IATAFrom>
                        <a:IATATo>${escapeXml(leg.to)}</a:IATATo>
                    </a:SearchFlight>`
    )
    .join('\n');

  return `<s:Envelope xmlns:s="${NS.soap12}">
    <s:Body>
        <AeroSearch xmlns="${NS.tempuri}">
            <credentials xmlns:a="${NS.common}" xmlns:i="${NS.instance}">
                <a:ApiLogin>${escapeXml(CONFIG.apiLogin)}</a:ApiLogin>
                <a:ApiPassword>${escapeXml(CONFIG.apiPassword)}</a:ApiPassword>
                <a:AuthExtendedData i:nil="true"/>
                <a:Currency>${escapeXml(CONFIG.currency)}</a:Currency>
                <a:DeviceId>${escapeXml(CONFIG.deviceId)}</a:DeviceId>
                <a:Language>${escapeXml(CONFIG.language)}</a:Language>
                <a:TokenGuid>${escapeXml(CONFIG.tokenGuid)}</a:TokenGuid>
            </credentials>
            <aeroSearchParams xmlns:a="${NS.search}" xmlns:i="${NS.instance}">
                <a:Adults>${req.adults}</a:Adults>
                <a:Childs>${req.children}</a:Childs>
                <a:ExtendedParams i:nil="true"/>
                <a:FlightClass>${escapeXml(req.flightClass)}</a:FlightClass>
                <a:Infants>${req.infants}</a:Infants>
                <a:SearchFlights>
${flightRows}
                </a:SearchFlights>
            </aeroSearchParams>
        </AeroSearch>
    </s:Body>
</s:Envelope>`;
}

/**
 * Shared `<credentials>` block used by every operation.
 * `prefix` is the namespace alias in scope for the SiteCity.Common schema.
 */
function credentialsXml(prefix) {
  const p = prefix || 'a:';
  return `<${p}ApiLogin>${escapeXml(CONFIG.apiLogin)}</${p}ApiLogin>
                <${p}ApiPassword>${escapeXml(CONFIG.apiPassword)}</${p}ApiPassword>
                <${p}AuthExtendedData i:nil="true"/>
                <${p}Currency>${escapeXml(CONFIG.currency)}</${p}Currency>
                <${p}DeviceId>${escapeXml(CONFIG.deviceId)}</${p}DeviceId>
                <${p}Language>${escapeXml(CONFIG.language)}</${p}Language>
                <${p}TokenGuid>${escapeXml(CONFIG.tokenGuid)}</${p}TokenGuid>`;
}

/**
 * Build the SOAP 1.2 AeroPrebook envelope (pre-booking / fare + service lookup).
 *
 * Request shape verified against SiteCity.Avia.Prebook.AeroPrebookParams:
 *   OfferCode (string), SearchGuid (guid)
 *
 * Same namespace rule as AeroSearch: the wrapper element is unqualified while
 * its children carry the locally declared `a:` prefix.
 *
 * @param {{offerCode:string, searchGuid:string}} req
 * @returns {string} SOAP XML envelope
 */
function buildAeroPrebookEnvelope(req) {
  return `<s:Envelope xmlns:s="${NS.soap12}">
    <s:Body>
        <AeroPrebook xmlns="${NS.tempuri}">
            <credentials xmlns:a="${NS.common}" xmlns:i="${NS.instance}">
                ${credentialsXml('a:')}
            </credentials>
            <aeroPrebookParams xmlns:a="${NS.prebook}" xmlns:i="${NS.instance}">
                <a:OfferCode>${escapeXml(req.offerCode)}</a:OfferCode>
                <a:SearchGuid>${escapeXml(req.searchGuid)}</a:SearchGuid>
            </aeroPrebookParams>
        </AeroPrebook>
    </s:Body>
</s:Envelope>`;
}

/**
 * Build the SOAP 1.2 AeroBook envelope (create the booking).
 *
 * Request shape verified against SiteCity.Avia.Booking.AeroBookParams.
 * Only integer service IDs that AeroPrebook actually returned may be sent:
 *   SelectedEmd       -> [{ Id, Rph, Quantity }]
 *   SelectedServices  -> [{ Id, Rph }]
 *   SelectedTariffs   -> [int]
 *
 * @param {{offerCode:string, searchGuid:string, paxList:Array,
 *          selectedEmd:Array, selectedServices:Array, selectedTariffs:Array,
 *          email:string, phone:string, customerFio:string,
 *          clientReference:string, userTimeZone:number}} req
 * @returns {string} SOAP XML envelope
 */
function buildAeroBookEnvelope(req) {
  const paxRows = (req.paxList || [])
    .map(
      (p) => `                <a:PaxData>
                    <a:AgeType>${escapeXml(p.ageType || 'Adult')}</a:AgeType>
                    <a:GenderType>${escapeXml(p.genderType || 'NoSpecified')}</a:GenderType>
                    <a:Name>${escapeXml(p.name || '')}</a:Name>
                    <a:MiddleName>${escapeXml(p.middleName || '')}</a:MiddleName>
                    <a:Surname>${escapeXml(p.surname || '')}</a:Surname>
                    <a:BirthDay>${escapeXml(p.birthDay || '')}</a:BirthDay>
                </a:PaxData>`
    )
    .join('\n');

  const emdRows = (req.selectedEmd || [])
    .map(
      (e) => `                <a:SelectedEmd>
                    <a:Id>${Number(e.id)}</a:Id>
                    <a:Rph>${Number(e.rph || 1)}</a:Rph>
                    <a:Quantity>${Number(e.quantity || 1)}</a:Quantity>
                </a:SelectedEmd>`
    )
    .join('\n');

  const serviceRows = (req.selectedServices || [])
    .map(
      (s) => `                <a:SelectedService>
                    <a:Id>${Number(s.id)}</a:Id>
                    <a:Rph>${Number(s.rph || 1)}</a:Rph>
                </a:SelectedService>`
    )
    .join('\n');

  const tariffRows = (req.selectedTariffs || [])
    .map((id) => `                <a:int>${Number(id)}</a:int>`)
    .join('\n');

  // The ArrayOf* wrappers are only meaningful when they have content.
  const emdBlock = emdRows
    ? `
                <a:SelectedEmd>
${emdRows}
                </a:SelectedEmd>`
    : '';
  const serviceBlock = serviceRows
    ? `
                <a:SelectedServices>
${serviceRows}
                </a:SelectedServices>`
    : '';
  const tariffBlock = tariffRows
    ? `
                <a:SelectedTariffs>
${tariffRows}
                </a:SelectedTariffs>`
    : '';

  return `<s:Envelope xmlns:s="${NS.soap12}">
    <s:Body>
        <AeroBook xmlns="${NS.tempuri}">
            <credentials xmlns:a="${NS.common}" xmlns:i="${NS.instance}">
                ${credentialsXml('a:')}
            </credentials>
            <aeroBookParams xmlns:a="${NS.booking}" xmlns:i="${NS.instance}" xmlns:z="${NS.arrays}">
                <a:Email>${escapeXml(req.email || '')}</a:Email>
                <a:Phone>${escapeXml(req.phone || '')}</a:Phone>
                <a:CustomerFIO>${escapeXml(req.customerFio || '')}</a:CustomerFIO>
                <a:ClientReference>${escapeXml(req.clientReference || '')}</a:ClientReference>
                <a:OfferCode>${escapeXml(req.offerCode)}</a:OfferCode>
                <a:SearchGuid>${escapeXml(req.searchGuid)}</a:SearchGuid>
                <a:UserTimeZone>${Number(req.userTimeZone || 0)}</a:UserTimeZone>
                <a:PaxList>
${paxRows}
                </a:PaxList>${emdBlock}${serviceBlock}${tariffBlock}
            </aeroBookParams>
        </AeroBook>
    </s:Body>
</s:Envelope>`;
}

/**
 * Build the SOAP 1.2 AeroSeatMap envelope (cabin seat map).
 *
 * Request shape verified against SiteCity.Avia.SeatMap.AeroSeatMapParams:
 *   OfferCode, SearchGuid, FlightNum (string), Rph (int), SelectedTariffs
 *
 * @param {{offerCode:string, searchGuid:string, flightNum:string, rph:number}} req
 * @returns {string} SOAP XML envelope
 */
function buildAeroSeatMapEnvelope(req) {
  return `<s:Envelope xmlns:s="${NS.soap12}">
    <s:Body>
        <AeroSeatMap xmlns="${NS.tempuri}">
            <credentials xmlns:a="${NS.common}" xmlns:i="${NS.instance}">
                ${credentialsXml('a:')}
            </credentials>
            <aeroSeatMapParams xmlns:a="${NS.seatmap}" xmlns:i="${NS.instance}">
                <a:FlightNum>${escapeXml(req.flightNum)}</a:FlightNum>
                <a:OfferCode>${escapeXml(req.offerCode)}</a:OfferCode>
                <a:Rph>${Number(req.rph || 1)}</a:Rph>
                <a:SearchGuid>${escapeXml(req.searchGuid)}</a:SearchGuid>
                <a:SelectedTariffs/>
            </aeroSeatMapParams>
        </AeroSeatMap>
    </s:Body>
</s:Envelope>`;
}

// ---------------------------------------------------------------------------
// SOAP call
// ---------------------------------------------------------------------------

/**
 * POST a SOAP envelope to SiteCity.
 *
 * Throws an Error decorated with `.httpStatus` on transport/timeout problems.
 *
 * @param {string} envelope  Full SOAP 1.2 XML body
 * @param {string} [soapAction] Action URI; defaults to AeroSearch
 */
async function callSiteCity(envelope, soapAction) {
  const startedAt = Date.now();
  const action = soapAction || SOAP_ACTION;

  try {
    const response = await axios.post(CONFIG.siteCityUrl, envelope, {
      timeout: CONFIG.requestTimeoutMs,
      responseType: 'text',
      decompress: true, // the endpoint always gzips its responses
      // fast-xml-parser does the parsing; keep axios from re-parsing JSON.
      transformResponse: [(data) => data],
      headers: {
        // SOAP 1.2 carries the action as a Content-Type parameter.
        // (A plain `SOAPAction` header is SOAP 1.1 style and makes the service
        // answer with ActionNotSupported.)
        'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
        Accept: 'application/soap+xml, text/xml, */*',
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'nowtobook-server/1.0'
      },
      validateStatus: () => true // SOAP faults come back with HTTP 500
    });

    console.log(
      `[SiteCity] POST ${CONFIG.siteCityUrl} (${action.split('/').pop()}) -> ` +
        `HTTP ${response.status} in ${Date.now() - startedAt}ms`
    );

    return { status: response.status, body: response.data };
  } catch (error) {
    if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
      const timeoutError = new Error(
        `SiteCity request timed out after ${CONFIG.requestTimeoutMs}ms`
      );
      timeoutError.httpStatus = 504;
      throw timeoutError;
    }

    const networkError = new Error(`Could not reach SiteCity: ${error.message}`);
    networkError.httpStatus = 502;
    throw networkError;
  }
}

// ---------------------------------------------------------------------------
// Response parsing + mapping
// ---------------------------------------------------------------------------

/**
 * Dig the method's result payload out of a SOAP envelope.
 *
 * Each operation names its payload differently:
 *   AeroSearch  -> AeroSearchResponse  / AeroSearchResult
 *   AeroPrebook -> AeroPrebookResponse / AeroPrebookResult
 *   AeroBook    -> AeroBookResponse    / AeroBookResult
 * All of them wrap the same BaseResponse (Currency/Success/ErrorCode/...).
 */
function extractResult(parsed, method) {
  const envelope = parsed && parsed.Envelope;
  const body = envelope && envelope.Body;
  if (!body) return { fault: null, result: null };

  if (body.Fault) {
    const reason =
      (body.Fault.Reason && body.Fault.Reason.Text) || body.Fault.faultstring || 'Unknown SOAP fault';
    const detail = body.Fault.Detail && body.Fault.Detail.GenericException;
    return {
      fault: {
        reason: textOf(reason) || String(reason),
        code: detail ? textOf(detail.Code) : '',
        description: detail ? textOf(detail.Description) : ''
      },
      result: null
    };
  }

  const name = method || 'AeroSearch';
  const response = body[`${name}Response`];
  if (!response) return { fault: null, result: null };

  return { fault: null, result: response[`${name}Result`] || response };
}

/** Build the IATA -> { city, name } lookup from `AirPorts.AirPortInfo[]`. */
/** Build the IATA -> {city,name,country} lookup from `AirPorts.AirPortInfo[]`. */
function buildAirportMap(result) {
  const map = {};

  const put = (iata, city, name, country) => {
    const code = String(iata || '').toUpperCase();
    if (!code) return;
    const existing = map[code] || {};
    map[code] = {
      city: city || existing.city || '',
      name: name || existing.name || '',
      country: country || existing.country || ''
    };
  };

  collection(result.AirPorts, 'AirPortInfo').forEach((info) => {
    put(textOf(info.Iata), textOf(info.City), textOf(info.Name), textOf(info.Country));
  });

  // The provider often omits City/Name (e.g. BOM), which would leave the
  // frontend showing a bare IATA code. Fill the gaps from the bundled dataset.
  LOCAL_AIRPORTS.forEach((a) => {
    const code = String(a.code || '').toUpperCase();
    if (map[code]) {
      if (!map[code].city && a.city) map[code].city = a.city;
      if (!map[code].name && a.name) map[code].name = a.name;
      if (!map[code].country && a.country) map[code].country = a.country;
    } else {
      put(code, a.city, a.name, a.country);
    }
  });

  return map;
}

/** Build the airline code -> name lookup from `AirCompany.CodeValue[]`. */
function buildAirlineMap(result) {
  const map = {};
  const codes = collection(result.AirCompany, 'CodeValue');

  codes.forEach((cv) => {
    const code = textOf(cv.Code).toUpperCase();
    if (!code) return;
    map[code] = textOf(cv.Value) || code;
  });

  return map;
}

/**
 * Airport labels for every IATA code used by a result.
 *
 * The provider's own `AirPorts` block often omits airports (e.g. BOM comes back
 * without a City/Name), so it is merged with the bundled `data/airports.json`
 * for the codes that actually appear. The frontend then has real names to show
 * in the Flight Details timeline without shipping its own lookup.
 *
 * @returns {Object<string, {city:string, name:string, country:string}>}
 */
function buildAirportLabels(result, legs) {
  const labels = {};

  const put = (iata, city, name, country) => {
    const code = String(iata || '').toUpperCase();
    if (!code) return;
    const existing = labels[code] || {};
    labels[code] = {
      city: city || existing.city || '',
      name: name || existing.name || '',
      country: country || existing.country || ''
    };
  };

  // 1. The provider's own map.
  collection(result.AirPorts, 'AirPortInfo').forEach((info) => {
    put(textOf(info.Iata), textOf(info.City), textOf(info.Name), textOf(info.Country));
  });

  // 2. The bundled dataset, which has names the provider leaves blank.
  const used = new Set();
  legs.forEach((leg) => {
    if (leg.departureCode) used.add(leg.departureCode.toUpperCase());
    if (leg.arrivalCode) used.add(leg.arrivalCode.toUpperCase());
    (leg.segments || []).forEach((seg) => {
      if (seg.Departure && seg.Departure.Iata) used.add(String(seg.Departure.Iata).toUpperCase());
      if (seg.Arrival && seg.Arrival.Iata) used.add(String(seg.Arrival.Iata).toUpperCase());
    });
  });

  LOCAL_AIRPORTS.forEach((a) => {
    const code = String(a.code || '').toUpperCase();
    if (!code || !used.has(code)) return;
    put(code, a.city, a.name, a.country);
  });

  // Drop entries with nothing useful to show.
  Object.keys(labels).forEach((code) => {
    const l = labels[code];
    if (!l.city && !l.name) delete labels[code];
  });

  return labels;
}

/**
 * Turn one `OfferInfo` (a group of segments sharing an Rph) into a leg object
 * shaped like the ones in data/flights.json / expected by js/results.js.
 */
function buildLeg(offerInfo, airportMap, airlineMap) {
  const segments = collection(offerInfo.Segments, 'OfferSegment');
  if (segments.length === 0) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];

  const departure = splitDateTime(first.Departure && first.Departure.Date);
  const arrival = splitDateTime(last.Arrival && last.Arrival.Date);

  const departureCode = textOf(first.Departure && first.Departure.Iata).toUpperCase();
  const arrivalCode = textOf(last.Arrival && last.Arrival.Iata).toUpperCase();

  const departureInfo = airportMap[departureCode] || {};
  const arrivalInfo = airportMap[arrivalCode] || {};

  const durationMinutes = segments.reduce(
    (sum, seg) => sum + (Number(textOf(seg.FlightMinutes)) || 0),
    0
  );

  // Marketing airline of the FIRST segment drives the card's logo/name;
  // this matches how results.js picks `legs[0].airlineCode`.
  const airlineCode = textOf(first.MarketingAirline).toUpperCase();
  const airline = airlineMap[airlineCode] || textOf(first.MarketingAirlineName) || airlineCode || 'Airline';

  // The OPERATING carrier can differ from the marketing one (codeshare). On the
  // live endpoint, for example, SpiceJet (SG) and Air India Express (IX) flights
  // are marketed under Hahn Air (H1), so without this they look like "Hahn Air".
  const operatingCode = textOf(first.OperatingAirline).toUpperCase();
  const operatingAirline = operatingCode
    ? (airlineMap[operatingCode] || textOf(first.OperatingAirlineName) || operatingCode)
    : null;
  const isCodeshare = Boolean(operatingCode && operatingCode !== airlineCode);

  const stops = segments.length - 1;

  // Optional: layover detail derived from the connecting airports.
  const layovers = [];
  for (let i = 0; i < stops; i += 1) {
    const arriveAt = splitDateTime(segments[i].Arrival && segments[i].Arrival.Date);
    const departAt = splitDateTime(segments[i + 1].Departure && segments[i + 1].Departure.Date);
    const code = textOf(segments[i].Arrival && segments[i].Arrival.Iata).toUpperCase();
    layovers.push({
      code,
      city: (airportMap[code] || {}).city || code,
      duration: formatDuration(minutesBetween(arriveAt, departAt))
    });
  }

  return {
    airline,
    airlineCode,
    operatingAirline,
    operatingAirlineCode: operatingCode || null,
    isCodeshare,
    operatedBy: operatingCode || null,
    flightNumber: textOf(first.FlightNum),
    departureTime: departure.time,
    departureCode,
    departureCity: departureInfo.city || departureCode,
    departureDate: departure.date,
    departurePeriod: getDeparturePeriod(departure.time),
    arrivalTime: arrival.time,
    arrivalCode,
    arrivalCity: arrivalInfo.city || arrivalCode,
    arrivalDate: arrival.date,
    duration: formatDuration(durationMinutes),
    durationMinutes,
    stops,
    stopInfo: stops === 0 ? 'Non-stop' : `${stops} stop${stops > 1 ? 's' : ''}`,
    layovers,
    cabin: normalizeCabinLabel(textOf(first.FlightClass)),
    aircraft: textOf(first.AirCraft),
    // `segments` intentionally kept as the raw parsed array.
    segments
  };
}

/** Minutes between two "DD.MM.YYYY HH:MM" values (best effort). */
function minutesBetween(from, to) {
  if (!from.date || !to.date) return 0;
  const parse = (p) => {
    const [d, m, y] = p.date.split('.').map(Number);
    const [hh, mm] = p.time.split(':').map(Number);
    return Date.UTC(y, m - 1, d, hh, mm);
  };
  const diff = (parse(to) - parse(from)) / 60000;
  return Number.isFinite(diff) && diff > 0 ? Math.round(diff) : 0;
}

/** Map the WCF enum spelling back to a human label. */
function normalizeCabinLabel(flightClass) {
  const key = String(flightClass || '').toLowerCase();
  if (key.startsWith('premium')) return 'Premium Economy';
  if (key.startsWith('bus')) return 'Business';
  if (key.startsWith('first')) return 'First Class';
  if (key.startsWith('econom')) return 'Economy';
  return flightClass || 'Economy';
}

/**
 * Convert the parsed AeroSearchResult into the frontend's flights array.
 *
 * OfferInfo grouping (per the API contract, confirmed against live traffic):
 *   Rph = 1 -> outbound leg(s)
 *   Rph = 2 -> return leg(s)
 * A flight can carry several OfferInfo entries with the SAME Rph (different
 * supplier options for the same direction); only the first of each Rph is
 * used, which keeps one leg per direction as the UI expects.
 */
function mapFlights(result) {
  const airportMap = buildAirportMap(result);
  const airlineMap = buildAirlineMap(result);

  const flightDataArray = collection(result.FlightData, 'FlightData');
  const flights = [];

  // Required by AeroPrebook / AeroBook; the live response emits <a:SearchGuid>.
  const searchGuid = textOf(result.SearchGuid);

  flightDataArray.forEach((fd) => {
    const offerInfos = collection(fd.Offers, 'OfferInfo');

    const outboundOffers = offerInfos.filter((o) => Number(textOf(o.Rph)) === 1);
    const returnOffers = offerInfos.filter((o) => Number(textOf(o.Rph)) === 2);

    // A one-way search returns a single group; treat it as outbound even if
    // the service labelled it differently.
    const outboundSource = outboundOffers.length
      ? outboundOffers
      : offerInfos.filter((o) => Number(textOf(o.Rph)) !== 2);

    const outboundLeg = outboundSource.length
      ? buildLeg(outboundSource[0], airportMap, airlineMap)
      : null;
    if (!outboundLeg) return;

    const returnLeg = returnOffers.length
      ? buildLeg(returnOffers[0], airportMap, airlineMap)
      : null;

    const legs = returnLeg ? [outboundLeg, returnLeg] : [outboundLeg];

    const totalStops = legs.reduce((sum, leg) => sum + leg.stops, 0);
    const durationMinutes = legs.reduce((sum, leg) => sum + leg.durationMinutes, 0);

    // ---- Pricing ------------------------------------------------------
    // Per the API documentation the FlightData price fields are:
    //   TotalPrice  = the minimum cost of the offer, EXCLUDING the tariffs the
    //                 customer later selects and payment-system mark-ups
    //   AdultPrice / ChildPrice / InfantPrice = cost per passenger type
    //   TariffInfo.AdultBasePrice = the base fare component (before taxes)
    // These are all quoted in whatever CURRENCY we asked the provider for.
    const totalPrice = Number(textOf(fd.TotalPrice));
    const adultPrice = Number(textOf(fd.AdultPrice));
    const childPrice = Number(textOf(fd.ChildPrice));
    const infantPrice = Number(textOf(fd.InfantPrice));
    const tariffInfo = fd.TariffInfo || {};
    const adultBasePrice = Number(textOf(tariffInfo.AdultBasePrice));

    const providerCurrency = textOf(result.Currency) || CONFIG.currency;
    const targetCurrency = CONFIG.priceConversionEnabled ? CONFIG.baseCurrency : providerCurrency;

    // With conversion disabled (the default now that we request INR directly)
    // these pass the provider's own figures straight through.
    const money = (v) => (Number.isFinite(v) ? toBaseCurrency(v, providerCurrency) : null);

    const price = {
      // The provider's native figures, untouched.
      currency: providerCurrency,
      totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
      adultPrice: money(adultPrice),
      childPrice: money(childPrice),
      infantPrice: money(infantPrice),
      adultBasePrice: money(adultBasePrice),
      taxes: Number.isFinite(adultPrice) && Number.isFinite(adultBasePrice)
        ? money(adultPrice) - money(adultBasePrice)
        : null,
      // true when a multiplier was applied on the way out.
      converted: CONFIG.priceConversionEnabled &&
        String(providerCurrency).toUpperCase() !== String(targetCurrency).toUpperCase()
    };

    flights.push({
      id: textOf(fd.OfferCode),
      type: 'standard',
      // AeroPrebook/AeroBook need this paired with `id`.
      searchGuid,
      // basePrice is what js/results.js and js/data.js.formatPrice() consume.
      basePrice: money(totalPrice),
      currency: targetCurrency,
      cabin: outboundLeg.cabin,
      badge: null,
      fromCode: outboundLeg.departureCode,
      fromCity: outboundLeg.departureCity,
      toCode: outboundLeg.arrivalCode,
      toCity: outboundLeg.arrivalCity,
      totalDuration: formatDuration(durationMinutes),
      totalStops,
      durationMinutes,
      rating: Number(textOf(fd.Rating)) || 0,
      // Full price breakdown so the UI never has to guess.
      price,
      // Kept for backwards compatibility with the earlier shape.
      provider: {
        currency: providerCurrency,
        totalPrice: Number.isFinite(totalPrice) ? totalPrice : null,
        adultPrice: Number.isFinite(adultPrice) ? adultPrice : null
      },
      legs
    });
  });

  return flights;
}

// ---------------------------------------------------------------------------
// AeroPrebook / AeroBook mapping
// ---------------------------------------------------------------------------

/**
 * Map one `ServiceInfo` (SiteCity.Avia.Prebook) to the shape the booking page
 * consumes.
 *
 * Verified live against the test endpoint: an offer returns
 *   Services -> Insurance items (Basic tariff / Premium tariff / No insurance)
 *   Emd      -> EmdSeat items (Seat selection, several price tiers)
 * `Tariffs` is present in the schema but came back empty on the offer tested.
 */
function mapServiceInfo(s, providerCurrency) {
  const priceProvider = Number(textOf(s.Price)) || 0;
  return {
    id: Number(textOf(s.Id)),
    name: textOf(s.Name),
    // Converted so the booking page can add line items to basePrice directly.
    price: toBaseCurrency(priceProvider, providerCurrency),
    priceProvider,
    text: textOf(s.Text),
    type: textOf(s.Type),
    rph: textOf(s.Rph) ? Number(textOf(s.Rph)) : null,
    airCompany: textOf(s.AirCompany),
    airCompanyName: textOf(s.AirCompanyName),
    flightNum: textOf(s.FlightNum),
    maxQuantity: Number(textOf(s.MaxQuantity)) || 1
  };
}

/** Map an `ArrayOfServiceInfo` wrapper to a mapped array. */
function mapServiceList(container, providerCurrency) {
  return collection(container, 'ServiceInfo').map((s) => mapServiceInfo(s, providerCurrency));
}

/**
 * Map an AeroPrebookResult to the documented `/api/prebook` response.
 *
 * Note: `/api/flights` prices are converted to the frontend's base currency, so
 * prebook prices are converted the same way to keep the Order Summary
 * consistent. The untouched amount is kept on each item as `priceProvider`.
 */
function mapPrebook(result) {
  const providerCurrency = textOf(result.Currency) || CONFIG.currency;

  // `services` carries Insurance/SMS-style add-ons; seat/baggage extras arrive
  // in `Emd`. They are kept in separate collections so the UI can label them,
  // and both are concatenated in `allServices` for convenience.
  const services = mapServiceList(result.Services, providerCurrency);
  const emd = mapServiceList(result.Emd, providerCurrency);
  const tariffs = mapServiceList(result.Tariffs, providerCurrency);

  return {
    offerCode: textOf(result.OfferCode),
    searchGuid: textOf(result.SearchGuid),
    currency: CONFIG.baseCurrency,
    providerCurrency,
    fullPrice: toBaseCurrency(Number(textOf(result.FullPrice)) || 0, providerCurrency),
    fullPriceProvider: Number(textOf(result.FullPrice)) || 0,
    offers: collection(result.Offers, 'OfferInfo'),
    tariffs,
    services,
    emd,
    allServices: [...services, ...emd, ...tariffs],
    latNames: String(textOf(result.LatNames)).toLowerCase() === 'true',
    documentsRequired: String(textOf(result.DocumentsRequired)).toLowerCase() === 'true',
    middleNameRequired: String(textOf(result.MiddleNameRequired)).toLowerCase() === 'true',
    adultMinAge: Number(textOf(result.AdultMinAge)) || null,
    bookLimit: textOf(result.BookLimit)
  };
}

/** Map an AeroBookResult to the `/api/book` response. */
function mapBook(result) {
  const providerCurrency = textOf(result.Currency) || CONFIG.currency;
  const fullPriceProvider = Number(textOf(result.FullPrice)) || 0;

  return {
    bookId: Number(textOf(result.BookId)) || null,
    bookGuid: textOf(result.BookGuid),
    searchGuid: textOf(result.SearchGuid),
    fullPrice: toBaseCurrency(fullPriceProvider, providerCurrency),
    fullPriceProvider,
    providerCurrency,
    // A payment URL is only issued for some suppliers; treat as optional.
    paymentUrl: textOf(result.PaymentUrl) || null,
    confirmableTo: textOf(result.ConfirmableTo) || null,
    passedToSupplier: String(textOf(result.PassedToSupplier)).toLowerCase() === 'true',
    paxList: collection(result.PaxList, 'PaxData')
  };
}

// ---------------------------------------------------------------------------
// AeroSeatMap mapping (cabin seat map)
// ---------------------------------------------------------------------------

/** Human labels for the AeroSeatMapType enum values worth showing. */
const SEAT_PROP_LABELS = {
  Window: 'Window',
  AisleSeat: 'Aisle',
  CenterSeat: 'Middle',
  LegRoom: 'Extra legroom',
  Bulkhead: 'Bulkhead',
  AddExit: 'Exit row',
  Free: 'Free seat',
  Occupied: 'Occupied',
  Blocked: 'Blocked',
  Protected: 'Protected',
  NotForInfant: 'Not for infants',
  OnlyAdults: 'Adults only',
  LimitedComfort: 'Limited comfort',
  Quite: 'Quiet zone',
  MovieZone: 'Movie zone',
  Wing: 'Wing',
  Group: 'Group seat',
  Courtesy: 'Courtesy seat',
  LastOffer: 'Last offer',
  UnaccMinor: 'Unaccompanied minors only',
  RedMobility: 'Reduced mobility',
  Petc: 'Pet in cabin',
  Infant: 'Infant',
  Stretcher: 'Stretcher',
  CotBsct: 'Bassinet',
  Buffer_zone: 'Buffer zone',
  UpperDeck: 'Upper deck',
  RearFaced: 'Rear facing',
  Unknown: 'Unknown'
};

/** Props that only explain WHY a seat cannot be taken. */
const SEAT_BLOCKING_PROPS = new Set(['Blocked', 'Protected', 'Occupied']);

/**
 * Map one `AeroSeatChair`, or return null for an aisle gap.
 *
 * The provider emits a chair entry with an empty `Code` and no `EmdId` to mark
 * the aisle between seat blocks. It is not a seat, so it is dropped here rather
 * than rendered as an empty, unselectable cell.
 *
 * `EmdId` is the paid-seat service id; the same id is what AeroBook expects in
 * `SelectedEmd`, which is why the seat map and the add-on pricing line up.
 */
function mapSeat(chair) {
  const code = textOf(chair.Code).trim();
  const emdId = Number(textOf(chair.EmdId)) || null;
  if (!code && emdId == null) return null;

  const props = collection(chair.Props, 'AeroSeatMapType').map((p) => textOf(p));
  const available = String(textOf(chair.Available)).toLowerCase() === 'true' &&
    !props.some((p) => SEAT_BLOCKING_PROPS.has(p));

  return {
    code,
    emdId,
    available,
    aisle: String(textOf(chair.Aisle)).toLowerCase() === 'true',
    props,
    labels: props
      .filter((p) => !SEAT_BLOCKING_PROPS.has(p))
      .map((p) => SEAT_PROP_LABELS[p] || p)
      .filter(Boolean)
  };
}

/**
 * Map an AeroSeatMapResult to the shape the booking page renders.
 *
 * Note: this call is supplier-dependent — some flights answer with
 * `Success=false, ErrorString="Internal error"`, which the route surfaces as a
 * soft failure so the UI can offer a retry instead of breaking the page.
 */
function mapSeatMap(result) {
  const decks = collection(result.Map, 'AeroSeatMapDeck');

  const mappedDecks = decks.map((deck) => ({
    type: textOf(deck.Type),
    cabins: collection(deck.Cabine, 'AeroSeatMapCabin').map((cabin) => ({
      flightClass: textOf(cabin.FlightClass),
      rows: collection(cabin.Rows, 'AeroSeatMapRow').map((row) => ({
        number: Number(textOf(row.Number)) || 0,
        seats: collection(row.Chairs, 'AeroSeatChair').map(mapSeat).filter(Boolean)
      }))
    }))
  }));

  // Flattened rows for the renderer, keeping cabin/deck context.
  const rows = [];
  mappedDecks.forEach((deck) => {
    deck.cabins.forEach((cabin) => {
      cabin.rows.forEach((row) => {
        rows.push({ ...row, flightClass: cabin.flightClass, deck: deck.type });
      });
    });
  });
  rows.sort((a, b) => a.number - b.number);

  const allSeats = rows.flatMap((r) => r.seats);

  return {
    flightNum: textOf(result.FlightNum),
    decks: mappedDecks,
    rows,
    seatLetters: [...new Set(allSeats.map((s) => s.code))].sort(),
    rowCount: rows.length,
    seatCount: allSeats.length,
    availableCount: allSeats.filter((s) => s.available).length,
    // Every paid-seat tier present, so the caller can price them via AeroPrebook.
    emdIds: [...new Set(allSeats.map((s) => s.emdId).filter((id) => id != null))],
    currency: textOf(result.Currency) || CONFIG.currency
  };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const IATA_RE = /^[A-Za-z]{3}$/;

/**
 * Validate and normalise `req.query` into the internal search request.
 * Returns `{ error }` when the caller sent something unusable.
 */
function parseSearchQuery(query) {
  const from = String(query.from || '').trim().toUpperCase();
  const to = String(query.to || '').trim().toUpperCase();
  const cabin = String(query.cabin || 'Economy').trim();

  if (!from || !IATA_RE.test(from)) {
    return { error: 'Query parameter "from" must be a 3-letter IATA code (e.g. DEL).' };
  }
  if (!to || !IATA_RE.test(to)) {
    return { error: 'Query parameter "to" must be a 3-letter IATA code (e.g. JFK).' };
  }
  if (!query.departure) {
    return { error: 'Query parameter "departure" is required (YYYY-MM-DD).' };
  }

  const departure = toSiteCityDate(query.departure);
  if (!departure) {
    return { error: 'Query parameter "departure" must be a date like 2026-06-07.' };
  }

  let returnDate = null;
  if (query.return && String(query.return).trim()) {
    returnDate = toSiteCityDate(query.return);
    if (!returnDate) {
      return { error: 'Query parameter "return" must be a date like 2026-06-15.' };
    }
  }

  const adults = Math.max(1, Math.min(9, Number.parseInt(query.adults, 10) || 1));
  const children = Math.max(0, Math.min(8, Number.parseInt(query.children, 10) || 0));
  const infants = Math.max(0, Math.min(adults, Number.parseInt(query.infants, 10) || 0));

  if (!CABIN_MAP[cabin.toLowerCase()]) {
    return {
      error:
        'Query parameter "cabin" must be one of: Economy, Business, Premium Economy, First Class.'
    };
  }

  return {
    value: {
      outbound: { from, to, date: departure },
      inbound: returnDate ? { from: to, to: from, date: returnDate } : null,
      adults,
      children,
      infants,
      flightClass: toFlightClass(cabin),
      cabinLabel: cabin
    }
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// Dev-friendly CORS: the frontend is served from a different origin
// (e.g. http://localhost:8000) than this API.
app.use(cors({ origin: '*' }));
app.use(express.json());

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nowtobook-server',
    siteCityUrl: CONFIG.siteCityUrl,
    currency: CONFIG.currency,
    language: CONFIG.language,
    priceConversion: CONFIG.priceConversionEnabled
      ? `${CONFIG.currency} -> ${CONFIG.baseCurrency} @ ${CONFIG.sourceCurrencyRate}`
      : 'disabled',
    bookDryRun: CONFIG.bookDryRun
  });
});

// GET /api/flights
app.get('/api/flights', async (req, res) => {
  const parsed = parseSearchQuery(req.query);

  if (parsed.error) {
    console.log(`[flights] 400 bad request: ${parsed.error}`);
    return res.status(400).json({ success: false, error: parsed.error });
  }

  const search = parsed.value;
  console.log(
    `[flights] search start ${search.outbound.from} -> ${search.outbound.to} ` +
      `${search.outbound.date}` +
      `${search.inbound ? ` / ${search.inbound.date}` : ' (one-way)'} | ` +
      `pax A${search.adults} C${search.children} I${search.infants} | ` +
      `class=${search.cabinLabel} (${search.flightClass})`
  );

  try {
    const envelope = buildAeroSearchEnvelope(search);
    const { status, body } = await callSiteCity(envelope);

    const parsedXml = xmlParser.parse(body);
    const { fault, result } = extractResult(parsedXml);

    // --- SOAP fault -------------------------------------------------------
    if (fault) {
      // The service reports login/auth problems as faults with a small code.
      const isAuthFault = /login|auth|password/i.test(`${fault.reason} ${fault.description}`);
      console.error(`[flights] SOAP fault: ${fault.reason} (${fault.description || fault.code})`);

      return res.status(isAuthFault ? 502 : 500).json({
        success: false,
        error: isAuthFault
          ? 'Could not authenticate with the flight provider. Check API_LOGIN / API_PASSWORD.'
          : fault.reason,
        providerError: {
          code: fault.code,
          description: fault.description || fault.reason
        }
      });
    }

    if (!result) {
      console.error(`[flights] unexpected response (HTTP ${status}) with no AeroSearchResult`);
      return res.status(502).json({
        success: false,
        error: 'The flight provider returned an unexpected response.'
      });
    }

    // --- Success flag -----------------------------------------------------
    // The contract: Success=false + ErrorCode >= 1000 -> show ErrorString to
    // the user; otherwise show a generic message.
    const success = String(textOf(result.Success)).toLowerCase() === 'true';
    const errorCode = Number(textOf(result.ErrorCode)) || 0;
    const errorString = textOf(result.ErrorString);

    if (!success) {
      const generic = 'No flights found for your search.';
      // The test endpoint throttles with ErrorCode 1000 / "Search limit."
      const isThrottled = /limit/i.test(errorString);
      const userFacing = errorCode >= 1000 && errorString ? errorString : generic;

      console.log(`[flights] provider returned Success=false (ErrorCode=${errorCode}): ${errorString}`);

      // "No flights found" is a normal, non-exceptional outcome for the UI.
      return res.json({
        success: true,
        count: 0,
        flights: [],
        notice: isThrottled
          ? 'The flight provider is rate-limiting searches right now. Please wait a moment and try again.'
          : userFacing,
        providerError: { code: errorCode, message: errorString || null }
      });
    }

    // --- Map to the frontend shape ---------------------------------------
    const flights = mapFlights(result);
    console.log(`[flights] flights found: ${flights.length} (ResultCount=${textOf(result.ResultCount)})`);

    // Airport labels for the codes in this result, so the Flight Details
    // timeline can show "JFK-John F Kennedy Intl Airport".
    const airports = buildAirportLabels(result, flights.flatMap((f) => f.legs || []));

    return res.json({
      success: true,
      count: flights.length,
      currency: textOf(result.Currency) || CONFIG.currency,
      // Needed by GET /api/prebook; the frontend passes it back on Select.
      searchGuid: textOf(result.SearchGuid),
      airports,
      flights
    });
  } catch (error) {
    const httpStatus = error.httpStatus || 500;

    if (httpStatus === 504) {
      console.error(`[flights] timeout: ${error.message}`);
      return res.status(504).json({
        success: false,
        error: 'The flight provider took too long to respond. Please try again.'
      });
    }

    console.error(`[flights] error (${httpStatus}): ${error.message}`);
    return res.status(httpStatus).json({
      success: false,
      error:
        httpStatus === 502
          ? 'Could not reach the flight provider. Please try again later.'
          : 'Internal server error while searching flights.'
    });
  }
});

// GET /api/prebook
//
// Pre-booking lookup for one offer. SiteCity's AeroPrebook needs BOTH the
// OfferCode and the SearchGuid that produced it, so the frontend passes the
// guid it received from /api/flights.
app.get('/api/prebook', async (req, res) => {
  const offerCode = String(req.query.offerCode || '').trim();
  const searchGuid = String(req.query.searchGuid || '').trim();

  if (!offerCode) {
    return res.status(400).json({ success: false, error: 'Query parameter "offerCode" is required.' });
  }
  if (!searchGuid) {
    return res.status(400).json({
      success: false,
      error:
        'Query parameter "searchGuid" is required. AeroPrebook needs the guid returned by /api/flights.'
    });
  }

  console.log(`[prebook] offerCode=${offerCode.slice(0, 12)}… searchGuid=${searchGuid}`);

  try {
    const envelope = buildAeroPrebookEnvelope({ offerCode, searchGuid });
    const { status, body } = await callSiteCity(envelope, SOAP_ACTIONS.AeroPrebook);

    const parsedXml = xmlParser.parse(body);
    const { fault, result } = extractResult(parsedXml, 'AeroPrebook');

    if (fault) {
      console.error(`[prebook] SOAP fault: ${fault.reason} (${fault.description || fault.code})`);
      return res.status(502).json({
        success: false,
        error: fault.reason || 'The flight provider rejected the pre-booking request.',
        providerError: { code: fault.code, description: fault.description || fault.reason }
      });
    }

    if (!result) {
      console.error(`[prebook] no AeroPrebookResult (HTTP ${status})`);
      return res.status(502).json({
        success: false,
        error: 'The flight provider returned an unexpected pre-booking response.'
      });
    }

    const success = String(textOf(result.Success)).toLowerCase() === 'true';
    const errorCode = Number(textOf(result.ErrorCode)) || 0;
    const errorString = textOf(result.ErrorString);

    if (!success) {
      console.log(`[prebook] provider Success=false (ErrorCode=${errorCode}): ${errorString}`);
      return res.status(502).json({
        success: false,
        error: errorCode >= 1000 && errorString ? errorString : 'This fare is no longer available.',
        providerError: { code: errorCode, message: errorString || null }
      });
    }

    const prebook = mapPrebook(result);
    console.log(
      `[prebook] ok: fullPrice=${prebook.fullPrice} ${prebook.currency} | ` +
        `tariffs=${prebook.tariffs.length} services=${prebook.services.length} emd=${prebook.emd.length} | ` +
        `latNames=${prebook.latNames} documentsRequired=${prebook.documentsRequired}`
    );

    return res.json({ success: true, ...prebook });
  } catch (error) {
    const httpStatus = error.httpStatus || 500;
    console.error(`[prebook] error (${httpStatus}): ${error.message}`);
    return res.status(httpStatus).json({
      success: false,
      error:
        httpStatus === 504
          ? 'The flight provider took too long to respond. Please try again.'
          : 'Could not load fare and add-on options. Please try again.'
    });
  }
});

/**
 * Normalise the traveller payload from the booking form.
 * SiteCity `PaxData` uses Name / MiddleName / Surname, plus AgeType and
 * GenderType enums (Adult|Child|Infant, Male|Female|NoSpecified).
 */
function normalizePaxList(input, counts) {
  const list = Array.isArray(input) ? input : [];
  const genderOf = (g) => {
    const v = String(g || '').toLowerCase();
    if (v.startsWith('m')) return 'Male';
    if (v.startsWith('f')) return 'Female';
    return 'NoSpecified';
  };

  return list.map((p, i) => ({
    ageType: ['Adult', 'Child', 'Infant'].includes(p.ageType) ? p.ageType : 'Adult',
    genderType: genderOf(p.gender),
    name: String(p.firstName || p.name || '').trim(),
    middleName: String(p.middleName || '').trim(),
    surname: String(p.lastName || p.surname || '').trim(),
    birthDay: String(p.dob || p.birthDay || '').trim(),
    index: i,
    _counts: counts
  }));
}

// POST /api/book
//
// Creates the booking through SiteCity AeroBook. Only integer service IDs that
// AeroPrebook actually returned can be submitted (SelectedEmd /
// SelectedServices / SelectedTariffs); anything else has no representation in
// the API and is reported back as `ignoredSelections`.
app.post('/api/book', async (req, res) => {
  const payload = req.body || {};
  const offerCode = String(payload.offerCode || '').trim();
  const searchGuid = String(payload.searchGuid || '').trim();

  if (!offerCode || !searchGuid) {
    return res.status(400).json({
      success: false,
      error: 'Both "offerCode" and "searchGuid" are required to complete a booking.'
    });
  }

  const paxList = normalizePaxList(payload.paxList, payload);
  if (paxList.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one traveller is required.' });
  }

  const invalidPax = paxList.findIndex((p) => !p.name || !p.surname);
  if (invalidPax !== -1) {
    return res.status(400).json({
      success: false,
      error: `Traveller ${invalidPax + 1} is missing a first or last name.`
    });
  }

  if (!String(payload.email || '').trim()) {
    return res.status(400).json({ success: false, error: 'An email address is required.' });
  }
  if (!String(payload.phone || '').trim()) {
    return res.status(400).json({ success: false, error: 'A phone number is required.' });
  }

  // --- Services -----------------------------------------------------------
  // Only documented, API-backed selections can be transmitted. Meals and extra
  // baggage have no ServiceInfoType on the SiteCity enum, so if a client sends
  // them they are dropped here and reported instead of being silently lost.
  const selectedEmd = (Array.isArray(payload.selectedEmd) ? payload.selectedEmd : [])
    .filter((e) => Number.isFinite(Number(e.id)))
    .map((e) => ({ id: Number(e.id), rph: Number(e.rph || 1), quantity: Number(e.quantity || 1) }));

  const selectedServices = (Array.isArray(payload.selectedServices) ? payload.selectedServices : [])
    .filter((s) => Number.isFinite(Number(s.id)))
    .map((s) => ({ id: Number(s.id), rph: Number(s.rph || 1) }));

  const selectedTariffs = (Array.isArray(payload.selectedTariffs) ? payload.selectedTariffs : [])
    .map((t) => Number(typeof t === 'object' ? t.id : t))
    .filter((t) => Number.isFinite(t));

  const ignoredSelections = (Array.isArray(payload.ignoredSelections) ? payload.ignoredSelections : [])
    .map((x) => String(x));

  const bookRequest = {
    offerCode,
    searchGuid,
    paxList,
    selectedEmd,
    selectedServices,
    selectedTariffs,
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    customerFio: String(payload.customerFio || '').trim(),
    clientReference: String(payload.clientReference || '').trim(),
    userTimeZone: Number(payload.userTimeZone || 0)
  };

  console.log(
    `[book] ${bookRequest.paxList.length} pax | emd=${selectedEmd.length} ` +
      `services=${selectedServices.length} tariffs=${selectedTariffs.length} | dryRun=${CONFIG.bookDryRun}`
  );

  try {
    const envelope = buildAeroBookEnvelope(bookRequest);

    // --- Dry run ----------------------------------------------------------
    if (CONFIG.bookDryRun) {
      console.log('[book] BOOK_DRY_RUN is on — payload validated but NOT sent to AeroBook.');
      return res.json({
        success: true,
        dryRun: true,
        message:
          'BOOK_DRY_RUN is enabled, so nothing was booked. Set BOOK_DRY_RUN=false in server/.env to create real bookings.',
        request: {
          offerCode,
          searchGuid,
          paxCount: paxList.length,
          selectedEmd,
          selectedServices,
          selectedTariffs
        },
        ignoredSelections,
        // Provided so the payload can be inspected/tested without booking.
        soapLength: envelope.length
      });
    }

    const { status, body } = await callSiteCity(envelope, SOAP_ACTIONS.AeroBook);
    const parsedXml = xmlParser.parse(body);
    const { fault, result } = extractResult(parsedXml, 'AeroBook');

    if (fault) {
      console.error(`[book] SOAP fault: ${fault.reason} (${fault.description || fault.code})`);
      return res.status(502).json({
        success: false,
        error: fault.reason || 'The flight provider rejected the booking.',
        providerError: { code: fault.code, description: fault.description || fault.reason }
      });
    }

    if (!result) {
      console.error(`[book] no AeroBookResult (HTTP ${status})`);
      return res.status(502).json({
        success: false,
        error: 'The flight provider returned an unexpected booking response.'
      });
    }

    const success = String(textOf(result.Success)).toLowerCase() === 'true';
    const errorCode = Number(textOf(result.ErrorCode)) || 0;
    const errorString = textOf(result.ErrorString);

    if (!success) {
      console.log(`[book] provider Success=false (ErrorCode=${errorCode}): ${errorString}`);
      return res.status(502).json({
        success: false,
        error: errorCode >= 1000 && errorString ? errorString : 'The booking could not be completed.',
        providerError: { code: errorCode, message: errorString || null }
      });
    }

    const booking = mapBook(result);
    console.log(`[book] booked: BookId=${booking.bookId} BookGuid=${booking.bookGuid}`);

    return res.json({ success: true, dryRun: false, ignoredSelections, booking });
  } catch (error) {
    const httpStatus = error.httpStatus || 500;
    console.error(`[book] error (${httpStatus}): ${error.message}`);
    return res.status(httpStatus).json({
      success: false,
      error:
        httpStatus === 504
          ? 'The flight provider took too long to respond. The booking was not completed.'
          : 'Could not complete the booking. Please try again.'
    });
  }
});

// GET /api/seatmap
//
// Cabin seat map for one flight of an offer (SiteCity AeroSeatMap).
//
// This call is supplier-dependent: some flights answer with
// Success=false / ErrorString="Internal error" even though the offer is fine.
// That is returned as HTTP 200 with `available: false` and a reason, so the UI
// can offer a retry instead of treating it as a broken page.
app.get('/api/seatmap', async (req, res) => {
  const offerCode = String(req.query.offerCode || '').trim();
  const searchGuid = String(req.query.searchGuid || '').trim();
  const flightNum = String(req.query.flightNum || '').trim();
  const rph = Number(req.query.rph || 1) || 1;

  if (!offerCode || !searchGuid) {
    return res.status(400).json({
      success: false,
      error: 'Both "offerCode" and "searchGuid" are required to load a seat map.'
    });
  }
  if (!flightNum) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "flightNum" is required (e.g. AI-2573).'
    });
  }

  console.log(`[seatmap] ${flightNum} rph=${rph} offerCode=${offerCode.slice(0, 12)}…`);

  try {
    const envelope = buildAeroSeatMapEnvelope({ offerCode, searchGuid, flightNum, rph });
    const { status, body } = await callSiteCity(envelope, SOAP_ACTIONS.AeroSeatMap);

    const parsedXml = xmlParser.parse(body);
    const { fault, result } = extractResult(parsedXml, 'AeroSeatMap');

    if (fault) {
      console.error(`[seatmap] SOAP fault: ${fault.reason}`);
      return res.status(502).json({
        success: false,
        error: fault.reason || 'The provider rejected the seat map request.',
        providerError: { code: fault.code, description: fault.description || fault.reason }
      });
    }

    if (!result) {
      console.error(`[seatmap] no AeroSeatMapResult (HTTP ${status})`);
      return res.status(502).json({
        success: false,
        error: 'The provider returned an unexpected seat map response.'
      });
    }

    const success = String(textOf(result.Success)).toLowerCase() === 'true';
    const errorString = textOf(result.ErrorString);

    if (!success) {
      // Soft failure: no map for this flight, but the offer itself is fine.
      console.log(`[seatmap] no map for ${flightNum}: ${errorString || 'unknown'}`);
      return res.json({
        success: true,
        available: false,
        flightNum,
        reason: errorString || 'No seat map is available for this flight.',
        rows: [],
        seatLetters: [],
        emdIds: []
      });
    }

    const seatMap = mapSeatMap(result);

    if (seatMap.seatCount === 0) {
      console.log(`[seatmap] ${flightNum}: provider returned an empty map`);
      return res.json({
        success: true,
        available: false,
        flightNum,
        reason: 'The airline did not return a seat map for this flight.',
        rows: [],
        seatLetters: [],
        emdIds: []
      });
    }

    console.log(
      `[seatmap] ${flightNum}: ${seatMap.rowCount} row(s), ${seatMap.seatCount} seat(s), ` +
        `${seatMap.availableCount} available, ${seatMap.emdIds.length} price tier(s)`
    );

    return res.json({ success: true, available: true, ...seatMap });
  } catch (error) {
    const httpStatus = error.httpStatus || 500;
    console.error(`[seatmap] error (${httpStatus}): ${error.message}`);
    return res.status(httpStatus).json({
      success: false,
      error:
        httpStatus === 504
          ? 'The flight provider took too long to respond. Please try again.'
          : 'Could not load the seat map. Please try again.'
    });
  }
});

// Fallbacks
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Unknown endpoint: ${req.method} ${req.path}` });
});

app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[server] unhandled error:', error);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ---------------------------------------------------------------------------
// Start (only when run directly, so tests can require this module)
// ---------------------------------------------------------------------------

if (require.main === module) {
  app.listen(CONFIG.port, () => {
    console.log('--------------------------------------------------');
    console.log(`  Nowtobook SiteCity proxy listening on port ${CONFIG.port}`);
    console.log(`  Health  : http://localhost:${CONFIG.port}/api/health`);
    console.log(`  Search  : http://localhost:${CONFIG.port}/api/flights?from=LED&to=BAK&departure=2026-06-07`);
    console.log(`  Prebook : http://localhost:${CONFIG.port}/api/prebook?offerCode=…&searchGuid=…`);
    console.log(`  Book    : POST http://localhost:${CONFIG.port}/api/book`);
    console.log(`  Upstream: ${CONFIG.siteCityUrl} (${CONFIG.currency}/${CONFIG.language})`);
    if (CONFIG.bookDryRun) {
      console.log('  NOTE    : BOOK_DRY_RUN=true — /api/book validates but does NOT book.');
    }
    console.log('--------------------------------------------------');
  });
}

module.exports = {
  app,
  CONFIG,
  buildAeroSearchEnvelope,
  buildAeroPrebookEnvelope,
  buildAeroBookEnvelope,
  buildAeroSeatMapEnvelope,
  parseSearchQuery,
  mapFlights,
  mapPrebook,
  mapBook,
  mapSeatMap,
  mapServiceInfo,
  extractResult,
  toSiteCityDate,
  toFlightClass,
  toBaseCurrency,
  formatDuration,
  getDeparturePeriod,
  xmlParser
};
