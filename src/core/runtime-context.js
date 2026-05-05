import { SCRIPT, PAGE_KIND, launchPagePattern, webfredPagePattern } from './constants.js';

function detectRuntimeContext(currentLocation) {
  const url = new URL(currentLocation.href);
  const pathname = url.pathname || '/';

  if (url.origin !== SCRIPT.ORIGIN) {
    return freezeRuntimeContext({
      pageKind: PAGE_KIND.UNSUPPORTED,
      supported: false,
      reason: 'unsupported-origin',
      url,
    });
  }

  if (launchPagePattern.test(pathname)) {
    return freezeRuntimeContext({
      pageKind: PAGE_KIND.LAUNCH,
      supported: true,
      reason: 'launch-page-match',
      url,
    });
  }

  if (webfredPagePattern.test(pathname)) {
    return freezeRuntimeContext({
      pageKind: PAGE_KIND.WEBFRED,
      supported: true,
      reason: 'webfred-page-match',
      url,
    });
  }

  return freezeRuntimeContext({
    pageKind: PAGE_KIND.UNSUPPORTED,
    supported: false,
    reason: 'unsupported-path',
    url,
  });
}

function freezeRuntimeContext(context) {
  return Object.freeze({
    pageKind: context.pageKind,
    supported: context.supported,
    reason: context.reason,
    href: context.url.href,
    origin: context.url.origin,
    pathname: context.url.pathname,
    search: context.url.search,
  });
}

export { detectRuntimeContext, freezeRuntimeContext };
