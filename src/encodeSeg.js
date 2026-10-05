// Strict URL path-segment encoder. encodeURIComponent() deliberately leaves the RFC-3986
// sub-delimiters ! ' ( ) * unescaped — but Hebrew team names routinely contain a geresh
// apostrophe (נוער א', ב', ג', טרום א'). A raw trailing ' in an invite link gets truncated by
// WhatsApp/iMessage link detection and mangles the PWA manifest start_url on iOS (so the
// installed icon loses its team context and lands on the "use your personal link" gate).
// Percent-encoding those characters too makes team invite paths survive messaging apps + iOS install.
export const encodePathSeg = (s) =>
    encodeURIComponent(String(s ?? '')).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
