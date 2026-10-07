# Nowtobook — SiteCity SOAP backend proxy

Node.js (Express) backend that lets the existing Nowtobook frontend search live
flights through the **SiteCity** SOAP API (`AeroSearch`) without changing
`results.js`, `results.html`, `search.js` or `style.css`.

```
Browser (results.html)
   │  GET /api/flights?from=LED&to=BAK&departure=2026-10-31&return=2026-11-08...
   ▼
server.js  ──►  builds SOAP 1.2 XML (AeroSearch)
   │            POST http://test-api.xml.agency/SiteCity
   │            parses SOAP XML (fast-xml-parser)
   │            maps to the data/flights.json shape
   ▼
JSON  ──►  js/data.js getFlights()  ──►  js/results.js renders as before
```

---

## 1. Install

```bash
cd server
npm install
```

Then copy the environment template and adjust if needed:

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

> **pnpm users:** this project pins `node-linker=hoisted` in `.npmrc`. With
> pnpm 10/11 you may also need to pass it explicitly once:
> `pnpm install --config.node-linker=hoisted` (the isolated default layout
> breaks `express` → `body-parser` resolution under plain `node`).

### Requirements

* Node.js 18+ (developed and verified on Node 24)
* npm (or pnpm)

## 2. Run

```bash
npm start        # production-ish
npm run dev      # nodemon, restarts on change
```

The server listens on **http://localhost:5000** by default.

```
--------------------------------------------------
  Nowtobook SiteCity proxy listening on port 5000
  Health : http://localhost:5000/api/health
  Search : http://localhost:5000/api/flights?from=LED&to=BAK&departure=2026-06-07
  Upstream: http://test-api.xml.agency/SiteCity (EUR/EN)
--------------------------------------------------
```

## 3. Configuration (`server/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | HTTP port for this proxy |
| `SITECITY_URL` | `http://test-api.xml.agency/SiteCity` | SOAP endpoint |
| `API_LOGIN` | `test` | SiteCity `ApiLogin` |
| `API_PASSWORD` | `test` | SiteCity `ApiPassword` |
| `TOKEN_GUID` | `00000000-...-000000000000` | SiteCity `TokenGuid` |
| `DEVICE_ID` | `test` | SiteCity `DeviceId` |
| `CURRENCY` | `INR` | Currency we ask SiteCity to quote in. The provider prices **natively**, so this is the currency of every amount returned |
| `LANGUAGE` | `EN` | Response language |
| `REQUEST_TIMEOUT_MS` | `30000` | Upstream timeout (→ HTTP 504) |
| `PRICE_CONVERSION_ENABLED` | `false` | Apply a fixed multiplier to provider amounts. Off by default because the provider already quotes in `BASE_CURRENCY` |
| `BASE_CURRENCY` | `INR` | Currency the frontend treats `basePrice` as |
| `SOURCE_CURRENCY_RATE` | `0` | Multiplier used only when conversion is enabled. A hard-coded guess, not a live rate |
| `BOOK_DRY_RUN` | `true` | Validate `POST /api/book` without transmitting it to AeroBook |

`.env` is git-ignored; `.env.example` is the committed template.

---

## 4. API

### `GET /api/health`

```json
{
  "status": "ok",
  "service": "nowtobook-server",
  "siteCityUrl": "http://test-api.xml.agency/SiteCity",
  "currency": "EUR",
  "language": "EN",
  "priceConversion": "EUR -> INR @ 106"
}
```

### `GET /api/flights`

| Query param | Required | Default | Notes |
| --- | --- | --- | --- |
| `from` | yes | – | 3-letter IATA code, e.g. `LED` |
| `to` | yes | – | 3-letter IATA code, e.g. `BAK` |
| `departure` | yes | – | `YYYY-MM-DD` (converted to `DD.MM.YYYY` for SOAP) |
| `return` | no | – | `YYYY-MM-DD`; omit for one-way |
| `adults` | no | `1` | 1–9 |
| `children` | no | `0` | 0–8 |
| `infants` | no | `0` | 0–adults |
| `cabin` | no | `Economy` | `Economy`, `Business`, `Premium Economy`, `First Class` |

**Success**

```json
{
  "success": true,
  "count": 469,
  "currency": "EUR",
  "flights": [
    {
      "id": "H4sIAAAA…",
      "type": "standard",
      "basePrice": 62977,
      "currency": "INR",
      "cabin": "Economy",
      "fromCode": "LED", "fromCity": "Saint Petersburg",
      "toCode": "GYD",   "toCity": "Baku",
      "totalDuration": "11h 30m",
      "totalStops": 1,
      "durationMinutes": 690,
      "rating": 0,
      "provider": { "currency": "EUR", "totalPrice": 594.12, "adultPrice": 594.12 },
      "legs": [
        {
          "airline": "Azerbaijan Airlines", "airlineCode": "J2",
          "departureTime": "00:30", "departureCode": "LED", "departureCity": "Saint Petersburg",
          "arrivalTime": "05:40",   "arrivalCode": "GYD",   "arrivalCity": "Baku",
          "duration": "4h 10m", "durationMinutes": 250,
          "stops": 0, "stopInfo": "Non-stop",
          "departurePeriod": "night",
          "layovers": [], "segments": [ … raw SOAP segments … ]
        }
      ]
    }
  ]
}
```

**No results / provider rejection** — still HTTP 200 with an empty array plus a
human-readable `notice`, so the results page shows its normal "no flights"
state:

```json
{
  "success": true,
  "count": 0,
  "flights": [],
  "notice": "Error in the date of departure",
  "providerError": { "code": 1000, "message": "Error in the date of departure" }
}
```

**Errors**

| Status | When |
| --- | --- |
| `400` | Missing/invalid `from`, `to`, `departure`, `return` or `cabin` |
| `500` | Unexpected SOAP response, or an unhandled upstream error |
| `502` | Network failure, or an authentication fault from SiteCity |
| `504` | SiteCity exceeded `REQUEST_TIMEOUT_MS` |

### `GET /api/prebook`

Fare and add-on lookup for one offer (SiteCity `AeroPrebook`).

| Query param | Required | Notes |
| --- | --- | --- |
| `offerCode` | yes | The `flights[].id` value from `/api/flights` |
| `searchGuid` | yes | The `searchGuid` returned by `/api/flights` |

Both are required — SiteCity will not pre-book with the offer code alone.

```json
{
  "success": true,
  "offerCode": "H4sIAAAA…",
  "searchGuid": "125df0a2-156b-419a-91a9-d9347392affa",
  "currency": "INR",
  "providerCurrency": "EUR",
  "fullPrice": 31310,
  "fullPriceProvider": 295.38,
  "tariffs": [],
  "services": [
    { "id": 22, "name": "Basic tariff", "price": 684, "priceProvider": 6.45,
      "type": "Insurance", "rph": null, "text": "- 150 EUR in case of the flight cancellation…" }
  ],
  "emd": [
    { "id": 121, "name": "Seat selection", "price": 1182, "priceProvider": 11.15,
      "type": "EmdSeat", "rph": 1, "flightNum": "J2-20", "maxQuantity": 1 }
  ],
  "allServices": [ "…services followed by emd…" ],
  "latNames": true,
  "documentsRequired": true,
  "bookLimit": "None",
  "offers": [ "…raw OfferInfo array…" ]
}
```

Two shapes to be aware of, both verified against the live service:

* `services` carries Insurance / SMS style add-ons.
* `emd` carries seat and baggage extras (`EmdSeat`, `EmdBaggage`).
* `tariffs` is present in the schema but came back **empty** for every offer tested.

The search response also carries an `airports` map for the codes in that result:

```jsonc
{
  "searchGuid": "…",
  "airports": {
    "DEL": { "city": "New Delhi", "name": "Indira Gandhi International Airport", "country": "India" },
    "BOM": { "city": "Mumbai",  "name": "Chhatrapati Shivaji Maharaj International Airport", "country": "India" }
  },
  "flights": [ /* … */ ]
}
```

This exists because the provider's own `AirPorts` block omits City/Name for some
codes (BOM comes back blank), and `buildLeg` would otherwise fall back to showing
a bare IATA code. `buildAirportMap` / `buildAirportLabels` merge the provider's
map with the frontend's bundled `data/airports.json`, so the Flight Details
timeline can render "JFK-John F Kennedy Intl Airport" without a second request.

### `GET /api/seatmap`

Cabin seat map for one flight of an offer (SiteCity `AeroSeatMap`).

| Query | Required | Notes |
| --- | --- | --- |
| `offerCode` | yes | from search / prebook |
| `searchGuid` | yes | from search |
| `flightNum` | yes | as the provider spells it, e.g. `AI-2678` |
| `rph` | no | `1` outbound (default), `2` return |

```jsonc
{
  "success": true,
  "available": true,
  "flightNum": "AI-2678",
  "currency": "INR",
  "seatLetters": ["A", "B", "C", "D", "E", "F"],
  "rowCount": 22,
  "seatCount": 132,
  "availableCount": 106,
  "emdIds": [122, 123, 124, 121],
  "rows": [
    {
      "number": 7,
      "flightClass": "Econom",
      "deck": "MainDeck",
      "seats": [
        { "code": "A", "emdId": 122, "available": false, "aisle": false,
          "props": ["Window"], "labels": ["Window"] },
        { "code": "C", "emdId": 122, "available": true, "aisle": true,
          "props": ["AisleSeat", "Free"], "labels": ["Aisle", "Free seat"] }
      ]
    }
  ]
}
```

Notes, all verified against the live service:

* **This call is supplier-dependent.** Individual flights answer
  `Success=false, ErrorString="Internal error"` even though the offer itself is
  fine. That comes back as HTTP **200** with `available: false` and a `reason`,
  so the UI can offer a retry instead of breaking the page.
* **Aisle gaps are filtered out.** The provider emits a chair entry with an empty
  `Code` and no `EmdId` to mark the aisle. It is not a seat, so it is dropped
  rather than rendered as an empty cell.
* **Seats without an `EmdId` are not bookable** (`Blocked`, already occupied,
  …). They are returned with `available: false` and cannot be selected.
* **`emdId` is the price key.** The same ids appear in `GET /api/prebook` →
  `emd[]`, which is where the actual seat price comes from. Confirmed 4/4 tiers
  matched: `122 → ₹1,556`, `123 → ₹1,439`, `124 → ₹1,030`, `121 → ₹737`.
* On booking, a chosen seat is sent as `selectedEmd: [{ id: <emdId>, rph, quantity: 1 }]`.

### `POST /api/book`

Creates the booking through SiteCity `AeroBook`.

```jsonc
{
  "offerCode": "H4sIAAAA…",
  "searchGuid": "125df0a2-…",
  "email": "traveller@example.com",
  "phone": "+911234567890",
  "customerFio": "Test Traveller",
  "paxList": [
    { "ageType": "Adult", "gender": "Male",
      "firstName": "Test", "middleName": "", "lastName": "Traveller", "dob": "1990-05-04" }
  ],
  // Only ids that /api/prebook actually returned can be transmitted.
  "selectedEmd":      [{ "id": 121, "rph": 1, "quantity": 1 }],
  "selectedServices": [{ "id": 22,  "rph": 1 }],
  "selectedTariffs":  [],
  // Anything the API cannot represent, reported back rather than dropped silently.
  "ignoredSelections": ["Meal · traveller 1: Vegetarian"]
}
```

While `BOOK_DRY_RUN=true` (the default) the request is validated and the exact
payload is described, but **nothing is sent** to the provider:

```json
{
  "success": true,
  "dryRun": true,
  "message": "BOOK_DRY_RUN is enabled, so nothing was booked. …",
  "request": { "offerCode": "…", "searchGuid": "…", "paxCount": 1,
               "selectedEmd": [{ "id": 121, "rph": 1, "quantity": 1 }],
               "selectedServices": [{ "id": 22, "rph": 1 }],
               "selectedTariffs": [] },
  "ignoredSelections": [],
  "soapLength": 2383
}
```

With `BOOK_DRY_RUN=false` the response carries `booking`:

```json
{
  "success": true,
  "dryRun": false,
  "booking": {
    "bookId": 98765,
    "bookGuid": "11111111-2222-3333-4444-555555555555",
    "fullPrice": 62977,
    "providerCurrency": "EUR",
    "paymentUrl": "https://…",
    "passedToSupplier": true
  }
}
```

**Services the API cannot accept.** `AeroBook` takes add-ons only as integer
service ids (`SelectedEmd` / `SelectedServices` / `SelectedTariffs`), and the
`ServiceInfoType` enum has **no `Meal` member**. Meal preferences, special
assistance and frequent-flyer numbers therefore have no representation and are
returned in `ignoredSelections` instead of being silently discarded.

---

## 5. Testing

### curl

```bash
# health
curl "http://localhost:5000/api/health"

# round trip
curl "http://localhost:5000/api/flights?from=LED&to=BAK&departure=2026-10-31&return=2026-11-08&adults=1&cabin=Economy"

# one way
curl "http://localhost:5000/api/flights?from=LED&to=BAK&departure=2026-10-31&adults=1&cabin=Economy"

# validation error (expect HTTP 400)
curl -i "http://localhost:5000/api/flights?from=LED"
```

### Full booking chain

```bash
# 1. search — note the offerCode (flights[0].id) and searchGuid in the response
curl -s "http://localhost:5000/api/flights?from=LED&to=BAK&departure=2026-10-31&return=2026-11-08&adults=1&cabin=Economy"

# 2. fares + add-ons
curl -s "http://localhost:5000/api/prebook?offerCode=<OfferCode>&searchGuid=<SearchGuid>"

# 3. booking (validated only while BOOK_DRY_RUN=true)
curl -s -X POST "http://localhost:5000/api/book" \
  -H "Content-Type: application/json" \
  -d '{
        "offerCode": "<OfferCode>",
        "searchGuid": "<SearchGuid>",
        "email": "traveller@example.com",
        "phone": "+911234567890",
        "paxList": [{"ageType":"Adult","gender":"Male","firstName":"Test","lastName":"Traveller","dob":"1990-05-04"}],
        "selectedServices": [{"id": 22, "rph": 1}],
        "selectedEmd": [{"id": 121, "rph": 1, "quantity": 1}]
      }'
```

`npm test` runs the offline unit suite (`server/test/selftest.js`) covering date
and cabin mapping, validation, both SOAP envelope builders, XML escaping of user
input, and the AeroPrebook/AeroBook response mappers.

`npm run test:live` hits the **running** server instead
(`server/test/seatmap-live.js`) and checks the seat map and native-currency
pricing against the real provider:

```bash
npm start                 # in one terminal
npm run test:live 5000    # in another
```

Because the seat map is supplier-dependent, that test scans a handful of flights
and only fails if none of them produce a map.

### PowerShell

```powershell
Invoke-RestMethod "http://localhost:5000/api/flights?from=LED&to=BAK&departure=2026-10-31&return=2026-11-08&adults=1&cabin=Economy" |
  Select-Object success, count
```

### Postman

1. New request → `GET http://localhost:5000/api/flights`
2. Params: `from=LED`, `to=BAK`, `departure=2026-10-31`, `return=2026-11-08`, `adults=1`, `cabin=Economy`
3. Send — expect `"success": true` and a populated `flights` array.

### Frontend

Serve the project root over HTTP (not `file://`) and open `results.html`:

```bash
npx serve .          # or: python -m http.server 8000
```

Then search from `index.html`, or open directly:

```
http://localhost:8000/results.html?from=Saint%20Petersburg&fromCode=LED&to=Baku&toCode=BAK&departure=2026-10-31&return=2026-11-08&trip=roundtrip&adults=1&class=Economy
```

> **Use near-future dates.** The test endpoint rejects far-future departure
> dates with `ErrorCode 1000 — "Error in the date of departure"`. Dates roughly
> 1–8 weeks ahead work well.

---

## 6. Implementation notes (things that differ from the published spec)

The integration brief described a simpler contract than the service actually
implements. These were verified directly against the live WSDL, the imported
XSDs and real responses:

1. **SOAP action goes in `Content-Type`, not a `SOAPAction` header.**
   The endpoint is SOAP 1.2; sending `SOAPAction: …` returns
   `ActionNotSupported`. The action must be
   `Content-Type: application/soap+xml; charset=utf-8; action="http://tempuri.org/ISiteAvia/AeroSearch"`.

2. **`credentials` and `aeroSearchParams` must be *unqualified* elements**
   (`<credentials xmlns:a="…SiteCity.Common">`), not prefixed and not declared
   on the envelope. Qualifying them makes the service answer
   `<s:Fault>authInfo is null</s:Fault>`.

3. **`<a:AuthExtendedData i:nil="true"/>` must be present** inside
   `credentials`. Omitting it (or marking it nil incorrectly) also yields
   `authInfo is null`.

4. **`FlightClass` uses the WCF enum spellings** — `Econom`, `Business`,
   `PremiumEconom`, `First` — *not* `Economy` / `Premium Economy`.
   (`src: SiteCity.Avia.Common.Avia.Enums.FlightClass`)

5. **`AeroSearch` takes `SearchFlights` as an array of `SearchFlight`**
   (`Date` / `IATAFrom` / `IATATo`), with the return leg simply being the
   second entry with the airports reversed.

6. **Responses are always gzip-compressed** (even when
   `Accept-Encoding: identity` is sent), so the client must decompress.
   `axios` does this automatically via `decompress: true`.

7. **`Rph` grouping:** `Rph=1` is the outbound leg, `Rph=2` the return leg.
   A flight can carry several `OfferInfo` entries sharing the *same* `Rph`
   (alternative supplier options for one direction). This proxy keeps the first
   of each `Rph`, which yields one leg per direction as the UI expects.
   Some itineraries carry no return `OfferInfo` at all, so a round-trip search
   can legitimately return a few one-way cards.

8. **Airport codes may be metropolitan, not the airport served.** Searching
   `to=BAK` (Baku) returns flights arriving at `GYD`. `js/results.js` filters
   strictly by IATA code, which would hide every live result, so its endpoint
   match now also compares the city name carried in the search URL.

9. **The provider prices NATIVELY per currency — do not convert.**
   This was wrong at first: we requested `EUR` and multiplied by a guessed
   `106`, which inflated a real DEL→BOM fare of **₹8,795** into **₹11,341**.
   Requesting `INR` makes the provider quote real INR fares, so
   `CURRENCY=INR` and `PRICE_CONVERSION_ENABLED=false` are the correct pair.

   Verify any time with:

   ```bash
   npm run probe:currency            # defaults to DEL -> BOM
   npm run probe:currency BOM GOI    # or pick a route
   ```

   That prints the same fare quoted in INR / EUR / USD and the implied rate.

   Prices are also split out under `price` on every flight
   (`totalPrice`, `adultPrice`, `childPrice`, `infantPrice`, `adultBasePrice`,
   `taxes`, `converted`) so the UI can show the breakdown instead of one opaque
   number. Note the documented meaning of `TotalPrice`: the **minimum offer
   cost, excluding** the tariffs chosen later and payment-system mark-ups —
   `AeroPrebook.FullPrice` is the more complete figure once the offer is opened.

10. **Codeshare airlines.** Some offers are marketed by one carrier and flown by
    another. On the live endpoint SpiceJet (`SG`) and Air India Express (`IX`)
    flights are marketed under Hahn Air (`H1`), so the card would otherwise read
    "Hahn Air" for every one of them. Each leg now carries
    `operatingAirline` / `operatingAirlineCode` / `isCodeshare`, the booking page
    shows "Operated by …", and the airline filter matches the marketing **or**
    operating carrier.

11. **Flight Details timeline.** The drawer needs airport *names*, not just
    IATA codes. The provider leaves some blank, so the search response now
    carries an irports map built from the provider's AirPorts block merged
    with data/airports.json (see the GET /api/flights section). Layovers are
    computed **within** a leg only — pairing the last segment of the outbound
    leg with the first segment of the return leg produced nonsense like
    "199h 35m".

12. **The success-flag rules were kept as specified:** when `Success` is
    `false`, `ErrorCode >= 1000` surfaces `ErrorString` to the user, otherwise a
    generic message is used.

---

## 7. Files

| File | Purpose |
| --- | --- |
| `server.js` | Express app: SOAP envelope builder, client, parser, mapper, routes |
| `package.json` | Dependencies and `start` / `dev` scripts |
| `.env` | Local configuration (git-ignored) |
| `.env.example` | Configuration template |
| `.npmrc` | Forces a hoisted `node_modules` layout for pnpm |
| `.gitignore` | Ignores `node_modules/`, `.env`, `*.log` |

Frontend change: only `js/data.js → getFlights()` was rewritten to call this
API. `js/results.js` additionally received a small route-matching helper so
live airport codes resolve to the searched city (see note 8); nothing else in
the frontend was touched.

---

## 8. Frontend flow

Booking is a **right-side drawer**, not a separate page:

```
results.html
  └─ "Select" on an offer
       └─ FlightBooking.open(offer, searchGuid)        js/results.js
            ├─ GET  /api/prebook   → fares + add-ons    (js/booking.js)
            ├─ accordion cards: Flight · Add-ons · Traveler · Contact & Billing · Payment
            └─ POST /api/book      → booking            → confirmation.html
```

* `booking.html` no longer exists. The drawer is created on demand by
  `js/booking.js`, so it needs no page-level bootstrap.
* The drawer chrome (panel, backdrop, slide animation, responsive full-screen
  sheet) lives in `css/results.css`; the card content lives in `css/booking.css`.
* The offer object is handed straight from the results list, so the drawer never
  re-runs the search. Only `AeroPrebook` and `AeroBook` are called.
* Accessibility: `role="dialog"`, `aria-modal`, ESC to close, backdrop click,
  focus trap, and `body` scroll lock.

