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
