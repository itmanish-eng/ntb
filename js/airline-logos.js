/**
 * NOWTOBOOK — Airline Logos
 * Local assets/airline folder se SVG logos load karo
 */

// IATA code → local file name mapping (without extension)
const AIRLINE_LOGO_FILES = {
  "6E": "indigo",
  "AI": "airindia",
  "IX": "airindiaexpress",
  "QP": "akasaair",
  "AA": "americanairline",
  "BA": "britishairways",
  "DL": "delta",
  "EK": "emirates",
  "ET": "ethiopianairlines",
  "EY": "etihadairways",
  "AY": "finnair",
  "FZ": "flydubai",
  "XY": "flynas",
  "GF": "gulfair",
  "AZ": "itaairways",
  "JL": "japanairlines",
  "KL": "klm",
  "LO": "lot",
  "LH": "lufthansa",
  "WY": "omanair",
  "QR": "qatarairways",
  "SV": "saudia",
  "SG": "spicejet",
  "LX": "swiss",
  "TK": "turkishairlines",
  "VS": "virginatlantic",
   "TG": "thai",
   "UK": "vistara",
   "AF": "airfrance"
};

/**
 * Airline code se logo URL lo (local assets folder se)
 * @param {string} code - IATA code (jaise 'EK', '6E')
 * @returns {string} - Logo URL ya placeholder
 */
function getAirlineLogo(code) {
  if (!code) return "https://placehold.co/40x40/1e293b/38bdf8?text=?";
  const upperCode = code.toUpperCase();
  const fileName = AIRLINE_LOGO_FILES[upperCode];
  
  if (fileName) {
    return `assest/airline/${fileName}.svg`;   // ✅ SVG + assets/airline/
  }
  
  return `https://placehold.co/40x40/1e293b/38bdf8?text=${upperCode}`;
}

window.AIRLINE_LOGO_FILES = AIRLINE_LOGO_FILES;
window.getAirlineLogo = getAirlineLogo;