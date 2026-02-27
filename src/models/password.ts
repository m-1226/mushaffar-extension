export interface PasswordModel {
  id: string;
  keyName: string;
  password: string;
  email?: string;
  websiteUrl?: string;
  folderId?: string;
  lastEditDate: string; // ISO 8601
}

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    // Remove "www." prefix and return base domain
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.toLowerCase();
  }
}

export function matchesDomain(passwordUrl: string | undefined, pageUrl: string): boolean {
  if (!passwordUrl) return false;
  const passwordDomain = extractDomain(passwordUrl);
  const pageDomain = extractDomain(pageUrl);
  // Exact match or subdomain match (mail.google.com matches google.com)
  return pageDomain === passwordDomain || pageDomain.endsWith(`.${passwordDomain}`);
}
