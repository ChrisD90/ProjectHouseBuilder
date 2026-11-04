// Explicit per-workspace context: separate browser tabs can use different projects.
const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
export const projectID = Number(pathname.match(/^\/p\/([1-9]\d*)(?:\/|$)/)?.[1] || 1);
export const workspaceBase =
  pathname.match(/^\/p\/([1-9]\d*)(?:\/|$)/)?.[0].replace(/\/$/, '') || '';
export function projectURL(value: string) {
  if (!value.startsWith('/api/')) return value;
  const url = new URL(value, window.location.origin);
  url.searchParams.set('project_id', String(projectID));
  return url.pathname + url.search + url.hash;
}
export function workspaceURL(value: string) {
  return workspaceBase + value;
}

// Opening a funding document changes only a stacked dialog; the funding form stays mounted.
export function fundingDocumentOnly(
  current: { pathname: string; search: string; hash: string },
  next: { pathname: string; search: string; hash: string },
) {
  if (
    current.pathname !== next.pathname ||
    current.pathname.replace(/^\/p\/[1-9]\d*(?=\/)/, '') !== '/energieplanung' ||
    current.hash !== next.hash
  )
    return false;
  const before = new URLSearchParams(current.search),
    after = new URLSearchParams(next.search);
  const keys = ['funding_document', 'document_funding_id'];
  if (!keys.some((key) => before.get(key) !== after.get(key))) return false;
  for (const params of [before, after]) {
    for (const key of keys) {
      const value = params.get(key);
      if (value !== null && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))))
        return false;
      params.delete(key);
    }
    params.sort();
  }
  return before.toString() === after.toString();
}
