// Public settings only. Never put API keys, service-account JSON, or email secrets here.
window.ATTY_LEO_INQUIRIES = Object.freeze({
  enabled: false,
  privacyReviewed: false, // Owner review required; unresolved notice placeholders block activation.
  endpoint: '/api/inquiries', // HTTPS, same origin as the website; Worker route.
  turnstileSiteKey: '', // Public site key, restricted to the production hostname.
  privacyVersion: '2026-11-13-v3'
});
