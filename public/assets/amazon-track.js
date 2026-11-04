// Records every Amazon link click in GA4 as an "amazon_click" event, so clicks can be
// reported per guide (page path) and per product. Added to pages by
// scripts/add-amazon-tracking.py; needs the page's gtag snippet.
(function () {
  function product(url) {
    var asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (asin) return asin[1];
    return (url.searchParams.get('k') || '').slice(0, 100);
  }
  function track(e) {
    var a = e.target.closest && e.target.closest('a[href*="amazon.co.uk"]');
    if (!a || typeof gtag !== 'function') return;
    var url;
    try { url = new URL(a.href); } catch (err) { return; }
    gtag('event', 'amazon_click', {
      product: product(url),
      amazon_tag: url.searchParams.get('tag') || '',
      link_text: (a.textContent || '').trim().slice(0, 100),
      guide: location.pathname.replace(/^\/journal\/|\/$/g, ''),
      transport_type: 'beacon'
    });
  }
  document.addEventListener('click', track, true);
  document.addEventListener('auxclick', track, true); // middle-click / open in new tab
})();
