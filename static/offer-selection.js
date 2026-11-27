/* Read-only quote scenarios. Integer cents avoid cumulative floating-point drift. */
(function(root) {
  'use strict';
  const eligible = offer => ['Angebot','Angenommen','Beauftragt','Abgelehnt'].includes(offer.status);
  const accepted = offer => ['Angenommen','Beauftragt'].includes(offer.status);
  function summarize(offers, ids) {
    const selected = new Set([...ids].map(Number)), seen = new Set();
    const result = {count:0, selected:0, accepted:0, projected:0, missingSelected:0, missingProjected:0};
    for (const offer of offers) {
      if (!eligible(offer) || seen.has(Number(offer.id))) continue;
      seen.add(Number(offer.id));
      const included = selected.has(Number(offer.id)), committed = accepted(offer);
      const value = committed ? offer.agreed_gross ?? offer.gross : offer.gross;
      const amount = value == null || value === '' || !Number.isFinite(Number(value))
        ? null : Math.round((Number(value) + Number.EPSILON) * 100);
      if (included) {
        result.count++;
        if (amount == null) result.missingSelected++; else result.selected += amount;
      }
      if (committed && amount != null) result.accepted += amount;
      if (committed || included) {
        if (amount == null) result.missingProjected++; else result.projected += amount;
      }
    }
    for (const key of ['selected','accepted','projected']) result[key] /= 100;
    return result;
  }
  const api = {eligible, summarize};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PHBOfferSelection = api;
})(typeof window === 'undefined' ? globalThis : window);
