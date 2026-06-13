// Central place to map a hall/venue name (as it appears in the schedule sheet)
// to a precise map destination. Until exact addresses are confirmed, we fall
// back to a "<name> רעננה" search query.
//
// To make a pin EXACT: add an entry below with the full address, e.g.
//   'מטרו': 'אולם מטרו, רחוב ... , רעננה'
// or coordinates: 'מטרו': { lat: 32.18, lng: 34.87, label: 'אולם מטרו' }

export const HALL_ADDRESSES = {
    // name (cleaned)  ->  full address string OR { lat, lng, label }
    // (fill these in to get exact pins — see list provided to the admin)
};

// Strip times, status words and venue qualifiers to get the core venue name.
export function cleanHallName(loc) {
    if (!loc) return '';
    return loc
        .replace(/אתלטיקה/g, '')
        .replace(/אולם/g, '')
        .replace(/בחוץ|חוץ/g, '')
        .replace(/משחק|בית ?ספר|ב-/g, '')
        .replace(/[0-9:.\-–]/g, '')
        .replace(/🏀|🏃/g, '')
        .trim();
}

// Admin-defined hall addresses (saved by the Halls settings page on this device).
function readHallConfig() {
    try { return JSON.parse(localStorage.getItem('raananaHallConfig')) || {}; }
    catch { return {}; }
}

// Returns { query, hasExact, label } for building map / navigation links.
export function getHallDestination(loc) {
    const name = cleanHallName(loc);

    // 1) admin-configured address wins
    const cfg = readHallConfig();
    if (cfg[name] && cfg[name].address && cfg[name].address.trim()) {
        return { query: cfg[name].address.trim(), hasExact: true, label: name };
    }

    const entry = HALL_ADDRESSES[name];

    if (entry && typeof entry === 'object' && entry.lat != null) {
        return { query: `${entry.lat},${entry.lng}`, latlng: entry, hasExact: true, label: entry.label || name };
    }
    if (typeof entry === 'string' && entry.trim()) {
        return { query: entry, hasExact: true, label: name };
    }
    return { query: name ? `${name} רעננה` : 'רעננה', hasExact: false, label: name || loc };
}

export function googleMapsUrl(loc) {
    const { query } = getHallDestination(loc);
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function wazeUrl(loc) {
    const { query } = getHallDestination(loc);
    return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

export function isMobileDevice() {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}
