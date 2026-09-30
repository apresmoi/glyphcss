export const ANALYTICS_ID = 'G-PHHY1R5B58';
export const ANALYTICS_SRC = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
export const ANALYTICS_INIT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${ANALYTICS_ID}');`;
export const analyticsHead = [
  { tag: 'script', attrs: { async: true, src: ANALYTICS_SRC } },
  { tag: 'script', content: ANALYTICS_INIT },
];
