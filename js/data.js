/**
 * NOWTOBOOK — Data Service
 * Loads and provides Airports & Flights data with graceful offline fallback
 */

const FlightDataService = (() => {
  // Built-in fallback airports dataset (works offline / file:// protocol)
  const fallbackAirports = [
  { city: 'New Delhi', name: 'Indira Gandhi International Airport', code: 'DEL', country: 'India' },
  { city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International Airport', code: 'BOM', country: 'India' },
  { city: 'Bangalore', name: 'Kempegowda International Airport', code: 'BLR', country: 'India' },
  { city: 'Hyderabad', name: 'Rajiv Gandhi International Airport', code: 'HYD', country: 'India' },
  { city: 'Chennai', name: 'Chennai International Airport', code: 'MAA', country: 'India' },
  { city: 'Kolkata', name: 'Netaji Subhas Chandra Bose International Airport', code: 'CCU', country: 'India' },
  { city: 'Goa', name: 'Manohar International Airport', code: 'GOX', country: 'India' },
  { city: 'Dubai', name: 'Dubai International Airport', code: 'DXB', country: 'United Arab Emirates' },
  { city: 'Singapore', name: 'Singapore Changi Airport', code: 'SIN', country: 'Singapore' },
  { city: 'London', name: 'Heathrow Airport', code: 'LHR', country: 'United Kingdom' },
  { city: 'New York', name: 'John F. Kennedy International Airport', code: 'JFK', country: 'United States' },
  { city: 'Bangkok', name: 'Suvarnabhumi Airport', code: 'BKK', country: 'Thailand' },
  { city: 'Paris', name: 'Charles de Gaulle Airport', code: 'CDG', country: 'France' },
  { city: 'Toronto', name: 'Toronto Pearson International Airport', code: 'YYZ', country: 'Canada' },
  { city: 'Sydney', name: 'Sydney Kingsford Smith Airport', code: 'SYD', country: 'Australia' },
  { city: 'Los Angeles', name: 'Los Angeles International Airport', code: 'LAX', country: 'United States' },
  { city: 'Frankfurt', name: 'Frankfurt Airport', code: 'FRA', country: 'Germany' },
  { city: 'Tokyo', name: 'Narita International Airport', code: 'NRT', country: 'Japan' },
  { city: 'Istanbul', name: 'Istanbul Airport', code: 'IST', country: 'Turkey' },
  { city: 'Seoul', name: 'Incheon International Airport', code: 'ICN', country: 'South Korea' },
  { city: 'Hong Kong', name: 'Hong Kong International Airport', code: 'HKG', country: 'Hong Kong' },
  { city: 'Amsterdam', name: 'Amsterdam Airport Schiphol', code: 'AMS', country: 'Netherlands' },
  { city: 'Madrid', name: 'Adolfo Suárez Madrid–Barajas Airport', code: 'MAD', country: 'Spain' },
  { city: 'Rome', name: 'Leonardo da Vinci–Fiumicino Airport', code: 'FCO', country: 'Italy' },
  { city: 'Beijing', name: 'Beijing Capital International Airport', code: 'PEK', country: 'China' },
  { city: 'Shanghai', name: 'Shanghai Pudong International Airport', code: 'PVG', country: 'China' },
  { city: 'Moscow', name: 'Sheremetyevo International Airport', code: 'SVO', country: 'Russia' },
  { city: 'São Paulo', name: 'São Paulo/Guarulhos–Governador André Franco Montoro International Airport', code: 'GRU', country: 'Brazil' },
  { city: 'Mexico City', name: 'Mexico City International Airport', code: 'MEX', country: 'Mexico' },
  { city: 'Johannesburg', name: 'O. R. Tambo International Airport', code: 'JNB', country: 'South Africa' },
  { city: 'Cairo', name: 'Cairo International Airport', code: 'CAI', country: 'Egypt' },
  { city: 'Buenos Aires', name: 'Ministro Pistarini International Airport', code: 'EZE', country: 'Argentina' },
  { city: 'Lima', name: 'Jorge Chávez International Airport', code: 'LIM', country: 'Peru' },
  { city: 'Bangui', name: "Bangui M'Poko International Airport", code: 'BGF', country: 'Central African Republic' },
  { city: 'Nairobi', name: 'Jomo Kenyatta International Airport', code: 'NBO', country: 'Kenya' },
  { city: 'Helsinki', name: 'Helsinki-Vantaa Airport', code: 'HEL', country: 'Finland' },
  { city: 'Oslo', name: 'Oslo Gardermoen Airport', code: 'OSL', country: 'Norway' },
  { city: 'Stockholm', name: 'Stockholm Arlanda Airport', code: 'ARN', country: 'Sweden' },
  { city: 'Copenhagen', name: 'Copenhagen Airport', code: 'CPH', country: 'Denmark' },
  { city: 'Lisbon', name: 'Humberto Delgado Airport', code: 'LIS', country: 'Portugal' },
  { city: 'Vienna', name: 'Vienna International Airport', code: 'VIE', country: 'Austria' },
  { city: 'Zurich', name: 'Zurich Airport', code: 'ZRH', country: 'Switzerland' },
  { city: 'Athens', name: 'Athens International Airport', code: 'ATH', country: 'Greece' },
  { city: 'Warsaw', name: 'Warsaw Chopin Airport', code: 'WAW', country: 'Poland' },
  { city: 'Budapest', name: 'Budapest Ferenc Liszt International Airport', code: 'BUD', country: 'Hungary' },
  { city: 'Prague', name: 'Václav Havel Airport Prague', code: 'PRG', country: 'Czech Republic' },
  { city: 'Brussels', name: 'Brussels Airport', code: 'BRU', country: 'Belgium' },
  { city: 'Dublin', name: 'Dublin Airport', code: 'DUB', country: 'Ireland' },
  { city: 'Edinburgh', name: 'Edinburgh Airport', code: 'EDI', country: 'United Kingdom' },
  { city: 'Glasgow', name: 'Glasgow Airport', code: 'GLA', country: 'United Kingdom' },
  { city: 'Manchester', name: 'Manchester Airport', code: 'MAN', country: 'United Kingdom' },
  { city: 'Birmingham', name: 'Birmingham Airport', code: 'BHX', country: 'United Kingdom' },
  { city: 'Liverpool', name: 'Liverpool John Lennon Airport', code: 'LPL', country: 'United Kingdom' },
  { city: 'Bristol', name: 'Bristol Airport', code: 'BRS', country: 'United Kingdom' },
  { city: 'Leeds', name: 'Leeds Bradford Airport', code: 'LBA', country: 'United Kingdom' },
  { city: 'Newcastle', name: 'Newcastle International Airport', code: 'NCL', country: 'United Kingdom' },
  { city: 'Southampton', name: 'Southampton Airport', code: 'SOU', country: 'United Kingdom' },
  { city: 'Belfast', name: 'Belfast International Airport', code: 'BFS', country: 'United Kingdom' },
  { city: 'Cardiff', name: 'Cardiff Airport', code: 'CWL', country: 'United Kingdom' },
  { city: 'Stansted', name: 'London Stansted Airport', code: 'STN', country: 'United Kingdom' },
  { city: 'Luton', name: 'London Luton Airport', code: 'LTN', country: 'United Kingdom' },
  { city: 'Gatwick', name: 'London Gatwick Airport', code: 'LGW', country: 'United Kingdom' },
  { city: 'Atlanta', name: 'Hartsfield-Jackson Atlanta International Airport', code: 'ATL', country: 'United States' },
  { city: 'Dallas', name: 'Dallas/Fort Worth International Airport', code: 'DFW', country: 'United States' },
  { city: 'Denver', name: 'Denver International Airport', code: 'DEN', country: 'United States' },
  { city: 'Chicago', name: "Chicago O'Hare International Airport", code: 'ORD', country: 'United States' },
  { city: 'San Francisco', name: 'San Francisco International Airport', code: 'SFO', country: 'United States' },
  { city: 'Seattle', name: 'Seattle-Tacoma International Airport', code: 'SEA', country: 'United States' },
  { city: 'Miami', name: 'Miami International Airport', code: 'MIA', country: 'United States' },
  { city: 'Boston', name: 'General Edward Lawrence Logan International Airport', code: 'BOS', country: 'United States' },
  { city: 'Washington', name: 'Washington Dulles International Airport', code: 'IAD', country: 'United States' },
  { city: 'Houston', name: 'George Bush Intercontinental Airport', code: 'IAH', country: 'United States' },
  { city: 'Phoenix', name: 'Phoenix Sky Harbor International Airport', code: 'PHX', country: 'United States' },
  { city: 'Las Vegas', name: 'McCarran International Airport', code: 'LAS', country: 'United States' },
  { city: 'Orlando', name: 'Orlando International Airport', code: 'MCO', country: 'United States' },
  { city: 'Tokyo', name: 'Tokyo Haneda Airport', code: 'HND', country: 'Japan' },
  { city: 'Osaka', name: 'Kansai International Airport', code: 'KIX', country: 'Japan' },
  { city: 'Guangzhou', name: 'Guangzhou Baiyun International Airport', code: 'CAN', country: 'China' },
  { city: 'Doha', name: 'Hamad International Airport', code: 'DOH', country: 'Qatar' },
  { city: 'Abu Dhabi', name: 'Zayed International Airport', code: 'AUH', country: 'United Arab Emirates' },
  { city: 'Jeddah', name: 'King Abdulaziz International Airport', code: 'JED', country: 'Saudi Arabia' },
  { city: 'Riyadh', name: 'King Khalid International Airport', code: 'RUH', country: 'Saudi Arabia' },
  { city: 'Kuala Lumpur', name: 'Kuala Lumpur International Airport', code: 'KUL', country: 'Malaysia' },
  { city: 'Jakarta', name: 'Soekarno–Hatta International Airport', code: 'CGK', country: 'Indonesia' },
  { city: 'Manila', name: 'Ninoy Aquino International Airport', code: 'MNL', country: 'Philippines' },
  { city: 'Ho Chi Minh City', name: 'Tan Son Nhat International Airport', code: 'SGN', country: 'Vietnam' },
  { city: 'Hanoi', name: 'Noi Bai International Airport', code: 'HAN', country: 'Vietnam' },
  { city: 'Taipei', name: 'Taiwan Taoyuan International Airport', code: 'TPE', country: 'Taiwan' },
  { city: 'Melbourne', name: 'Melbourne Airport', code: 'MEL', country: 'Australia' },
  { city: 'Brisbane', name: 'Brisbane Airport', code: 'BNE', country: 'Australia' },
  { city: 'Perth', name: 'Perth Airport', code: 'PER', country: 'Australia' },
  { city: 'Auckland', name: 'Auckland Airport', code: 'AKL', country: 'New Zealand' },
  { city: 'Vancouver', name: 'Vancouver International Airport', code: 'YVR', country: 'Canada' },
  { city: 'Montreal', name: 'Montréal–Trudeau International Airport', code: 'YUL', country: 'Canada' },
  { city: 'Bogotá', name: 'El Dorado International Airport', code: 'BOG', country: 'Colombia' },
  { city: 'Santiago', name: 'Arturo Merino Benítez International Airport', code: 'SCL', country: 'Chile' },
  { city: 'Addis Ababa', name: 'Addis Ababa Bole International Airport', code: 'ADD', country: 'Ethiopia' },
  { city: 'Casablanca', name: 'Mohammed V International Airport', code: 'CMN', country: 'Morocco' },
  { city: 'Lagos', name: 'Murtala Muhammed International Airport', code: 'LOS', country: 'Nigeria' },
  { city: 'Accra', name: 'Kotoka International Airport', code: 'ACC', country: 'Ghana' },
  { city: 'Tel Aviv', name: 'Ben Gurion Airport', code: 'TLV', country: 'Israel' }
  ];

  // Currency Conversion Rates (base: INR)
  const currencyRates = {
    INR: { symbol: '₹', rate: 1.0, format: val => `₹${Math.round(val).toLocaleString('en-IN')}` },
    USD: { symbol: '$', rate: 0.012, format: val => `$${Math.round(val * 0.012).toLocaleString('en-US')}` },
    EUR: { symbol: '€', rate: 0.011, format: val => `€${Math.round(val * 0.011).toLocaleString('de-DE')}` },
    GBP: { symbol: '£', rate: 0.0095, format: val => `£${Math.round(val * 0.0095).toLocaleString('en-GB')}` },
    AED: { symbol: 'د.إ', rate: 0.044, format: val => `AED ${Math.round(val * 0.044).toLocaleString('en-US')}` }
  };

  let activeCurrency = localStorage.getItem('ntb_currency') || 'INR';
  let cachedAirports = null;
  let cachedFlights = null;

  /**
   * Fetch airports list
   */
  async function getAirports() {
    if (cachedAirports) return cachedAirports;
    try {
      const res = await fetch('data/airports.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cachedAirports = await res.json();
    } catch (err) {
      console.warn('Could not fetch data/airports.json via network, using local fallback:', err);
      cachedAirports = fallbackAirports;
    }
    return cachedAirports;
  }

  /**
   * Fetch all flights
   */
  async function getFlights() {
    if (cachedFlights) return cachedFlights;
    try {
      const res = await fetch('data/flights.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cachedFlights = await res.json();
    } catch (err) {
      console.warn('Could not fetch data/flights.json via network, using local fallback:', err);
      cachedFlights = [
        {
          id: 'fl-promoted-1',
          type: 'promoted',
          airline: 'Emirates',
          airlineCode: 'EK',
          partners: 'United Airlines, Air India',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Dubai',
          toCode: 'DXB',
          basePrice: 8499,
          dealsCount: 8,
          legs: [
            { airline: 'Emirates', airlineCode: 'EK', departureTime: '08:45 AM', departureCode: 'DEL', departureDate: 'Oct 12', arrivalTime: '11:20 AM', arrivalCode: 'DXB', duration: '3h 35m', stops: 0, stopInfo: 'Direct' },
            { airline: 'Emirates', airlineCode: 'EK', departureTime: '02:20 PM', departureCode: 'DXB', departureDate: 'Oct 20', arrivalTime: '07:15 PM', arrivalCode: 'DEL', duration: '3h 55m', stops: 0, stopInfo: 'Direct' }
          ]
        },
        {
          id: 'fl-promoted-2',
          type: 'promoted',
          airline: 'Etihad Airways',
          airlineCode: 'EY',
          partners: 'Etihad Airways, Air India',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Dubai',
          toCode: 'DXB',
          basePrice: 9240,
          dealsCount: 6,
          legs: [
            { airline: 'Etihad', airlineCode: 'EY', departureTime: '09:15 AM', departureCode: 'DEL', departureDate: 'Oct 12', arrivalTime: '01:30 PM', arrivalCode: 'DXB', duration: '4h 15m', stops: 1, stopInfo: '1 Stop (AUH)' },
            { airline: 'Etihad', airlineCode: 'EY', departureTime: '04:30 PM', departureCode: 'DXB', departureDate: 'Oct 20', arrivalTime: '10:50 PM', arrivalCode: 'DEL', duration: '4h 20m', stops: 1, stopInfo: '1 Stop (AUH)' }
          ]
        },
        {
          id: 'fl-std-1',
          type: 'standard',
          airline: 'IndiGo',
          airlineCode: '6E',
          flightNumber: '6E-205',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Mumbai',
          toCode: 'BOM',
          departureTime: '06:05',
          arrivalTime: '08:20',
          departurePeriod: 'early-morning',
          duration: '2h 15m',
          durationMinutes: 135,
          stops: 0,
          stopInfo: 'Non-stop',
          cabin: 'Economy',
          basePrice: 3499,
          badge: 'CHEAPEST'
        },
        {
          id: 'fl-std-2',
          type: 'standard',
          airline: 'Air India',
          airlineCode: 'AI',
          flightNumber: 'AI-865',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Mumbai',
          toCode: 'BOM',
          departureTime: '09:30',
          arrivalTime: '11:35',
          departurePeriod: 'morning',
          duration: '2h 05m',
          durationMinutes: 125,
          stops: 0,
          stopInfo: 'Non-stop',
          cabin: 'Economy',
          basePrice: 4199,
          badge: 'FASTEST'
        },
        {
          id: 'fl-std-3',
          type: 'standard',
          airline: 'SpiceJet',
          airlineCode: 'SG',
          flightNumber: 'SG-153',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Mumbai',
          toCode: 'BOM',
          departureTime: '13:45',
          arrivalTime: '16:15',
          departurePeriod: 'afternoon',
          duration: '2h 30m',
          durationMinutes: 150,
          stops: 0,
          stopInfo: 'Non-stop',
          cabin: 'Economy',
          basePrice: 2999,
          badge: 'BEST VALUE'
        },
        {
          id: 'fl-std-4',
          type: 'standard',
          airline: 'IndiGo',
          airlineCode: '6E',
          flightNumber: '6E-24',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Dubai',
          toCode: 'DXB',
          departureTime: '17:30',
          arrivalTime: '20:10',
          departurePeriod: 'evening',
          duration: '4h 10m',
          durationMinutes: 250,
          stops: 0,
          stopInfo: 'Non-stop',
          cabin: 'Economy',
          basePrice: 8199,
          badge: 'POPULAR'
        },
        {
          id: 'fl-std-5',
          type: 'standard',
          airline: 'Emirates',
          airlineCode: 'EK',
          flightNumber: 'EK-511',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Dubai',
          toCode: 'DXB',
          departureTime: '10:40',
          arrivalTime: '13:00',
          departurePeriod: 'morning',
          duration: '3h 50m',
          durationMinutes: 230,
          stops: 0,
          stopInfo: 'Non-stop',
          cabin: 'Economy',
          basePrice: 9499,
          badge: 'BEST VALUE'
        },
        {
          id: 'fl-std-6',
          type: 'standard',
          airline: 'Air India',
          airlineCode: 'AI',
          flightNumber: 'AI-995',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Dubai',
          toCode: 'DXB',
          departureTime: '20:00',
          arrivalTime: '22:30',
          departurePeriod: 'evening',
          duration: '4h 00m',
          durationMinutes: 240,
          stops: 0,
          stopInfo: 'Non-stop',
          cabin: 'Economy',
          basePrice: 7899,
          badge: 'CHEAPEST'
        },
        {
          id: 'fl-std-7',
          type: 'standard',
          airline: 'Qatar Airways',
          airlineCode: 'QR',
          flightNumber: 'QR-571',
          fromCity: 'New Delhi',
          fromCode: 'DEL',
          toCity: 'Dubai',
          toCode: 'DXB',
          departureTime: '04:15',
          arrivalTime: '09:40',
          departurePeriod: 'early-morning',
          duration: '6h 55m',
          durationMinutes: 415,
          stops: 1,
          stopInfo: '1 Stop (DOH)',
          cabin: 'Economy',
          basePrice: 9120,
          badge: ''
        }
      ];
    }
    return cachedFlights;
  }

  /**
   * Currency helpers
   */
  function getCurrency() {
    return activeCurrency;
  }

  function setCurrency(code) {
    if (currencyRates[code]) {
      activeCurrency = code;
      localStorage.setItem('ntb_currency', code);
      window.dispatchEvent(new CustomEvent('ntb:currency-changed', { detail: { currency: code } }));
    }
  }

  function formatPrice(amountInInr) {
    const config = currencyRates[activeCurrency] || currencyRates.INR;
    return config.format(amountInInr);
  }

  return {
    getAirports,
    getFlights,
    getCurrency,
    setCurrency,
    formatPrice,
    currencyRates
  };
})();

window.FlightDataService = FlightDataService;
