/**
 * Currency probe — checks what the provider actually quotes.
 *
 * Why this exists: the SiteCity test endpoint prices NATIVELY per currency.
 * Asking for EUR and multiplying by a guessed rate gives wrong fares
 * (DEL->BOM came back as 8795 INR natively but about 11341 INR via EUR x106).
 *
 * Run:  npm run probe:currency
 */
'use strict';

require('dotenv').config();

const http = require('http');
const zlib = require('zlib');

const NS = {
  soap12: 'http://www.w3.org/2003/05/soap-envelope',
  tempuri: 'http://tempuri.org/',
  common: 'http://schemas.datacontract.org/2004/07/SiteCity.Common',
  search: 'http://schemas.datacontract.org/2004/07/SiteCity.Avia.Search',
  instance: 'http://www.w3.org/2001/XMLSchema-instance'
};

const URL_ = process.env.SITECITY_URL || 'http://test-api.xml.agency/SiteCity';
const ROUTE = { from: process.argv[2] || 'DEL', to: process.argv[3] || 'BOM' };
const DAYS_AHEAD = Number(process.argv[4] || 30);

function envelope(currency, date) {
  const cfg = {
    login: process.env.API_LOGIN || 'test',
    password: process.env.API_PASSWORD || 'test',
    device: process.env.DEVICE_ID || 'test',
    language: process.env.LANGUAGE || 'EN',
    token: process.env.TOKEN_GUID || '00000000-0000-0000-0000-000000000000'
  };
  return `<s:Envelope xmlns:s="${NS.soap12}">
    <s:Body>
        <AeroSearch xmlns="${NS.tempuri}">
            <credentials xmlns:a="${NS.common}" xmlns:i="${NS.instance}">
                <a:ApiLogin>${cfg.login}</a:ApiLogin>
                <a:ApiPassword>${cfg.password}</a:ApiPassword>
                <a:AuthExtendedData i:nil="true"/>
                <a:Currency>${currency}</a:Currency>
                <a:DeviceId>${cfg.device}</a:DeviceId>
                <a:Language>${cfg.language}</a:Language>
                <a:TokenGuid>${cfg.token}</a:TokenGuid>
            </credentials>
            <aeroSearchParams xmlns:a="${NS.search}" xmlns:i="${NS.instance}">
                <a:Adults>1</a:Adults>
                <a:Childs>0</a:Childs>
                <a:ExtendedParams i:nil="true"/>
                <a:FlightClass>Econom</a:FlightClass>
                <a:Infants>0</a:Infants>
                <a:SearchFlights>
                    <a:SearchFlight>
                        <a:Date>${date}</a:Date>
                        <a:IATAFrom>${ROUTE.from}</a:IATAFrom>
                        <a:IATATo>${ROUTE.to}</a:IATATo>
                    </a:SearchFlight>
                </a:SearchFlights>
            </aeroSearchParams>
        </AeroSearch>
    </s:Body>
</s:Envelope>`;
}

function post(action, body) {
  return new Promise((resolve) => {
    const u = new URL(URL_);
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
        'Content-Length': Buffer.byteLength(body),
        'Accept-Encoding': 'gzip, deflate'
      },
      timeout: 120000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        try { resolve(zlib.gunzipSync(buf).toString('utf8')); }
        catch (e) { resolve(buf.toString('utf8')); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve('TIMEOUT'); });
    req.on('error', (e) => resolve('ERROR ' + e.message));
    req.write(body);
    req.end();
  });
}

function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function toSiteCityDate(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }

const numbers = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<[a-z]*:?${tag}>([\\d.]+)<`, 'g'))].map((m) => Number(m[1]));

(async () => {
  const date = toSiteCityDate(addDays(DAYS_AHEAD));
  console.log(`\nRoute ${ROUTE.from} -> ${ROUTE.to} on ${date}\n`);
  console.log('requested  response   n     TotalPrice (first 4)          AdultBasePrice');
  console.log('-'.repeat(78));

  const results = {};
  for (const cur of ['INR', 'EUR', 'USD']) {
    const xml = await post('http://tempuri.org/ISiteAvia/AeroSearch', envelope(cur, date));
    if (xml.startsWith('ERROR') || xml === 'TIMEOUT') {
      console.log(`${cur.padEnd(10)} ${xml.slice(0, 60)}`);
      continue;
    }
    const respCur = (xml.match(/<Currency[^>]*>([^<]*)</) || [, '?'])[1];
    const count = (xml.match(/<[a-z]*:?ResultCount>(\d+)</) || [, '?'])[1];
    const totals = numbers(xml, 'TotalPrice').slice(0, 4);
    const bases = numbers(xml, 'AdultBasePrice').slice(0, 4);
    const err = (xml.match(/<ErrorString[^>]*>([^<]*)</) || [, ''])[1];
    results[cur] = totals[0];

    console.log(
      `${cur.padEnd(10)} ${respCur.padEnd(10)} ${String(count).padStart(4)}  ` +
      `${totals.join(', ').padEnd(30)} ${bases.join(', ')}`
    );
    if (err) console.log(`           ErrorString: ${err}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('');
  if (results.EUR && results.INR) {
    const implied = results.INR / results.EUR;
    console.log(`cheapest fare: ${results.INR} INR == ${results.EUR} EUR`);
    console.log(`implied rate : 1 EUR = ${implied.toFixed(2)} INR`);
    console.log(
      `\n=> The provider prices natively. Requesting INR needs NO conversion,\n` +
      `   so keep CURRENCY=INR and PRICE_CONVERSION_ENABLED=false.`
    );
  }
})();
