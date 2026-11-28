export const appReleaseVersion = 'V2.8';

export function parseReleaseVersion(value: string): string | undefined {
  const version = value.trim().toUpperCase();
  return /^V(0|[1-9][0-9]{0,5})\.[0-9]$/.test(version) ? version : undefined;
}

export function versionedNoticeTitle(title: string, version?: string | null): string {
  const prefix = version && parseReleaseVersion(version);
  return prefix ? `${prefix} · ${title}` : title;
}
