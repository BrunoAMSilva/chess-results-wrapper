import { getLangParam } from "./request-params";

const LANG_COOKIE_OPTIONS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
  httpOnly: false,
};

type CookieValue = { value: string } | undefined;

type CookieStore = {
  get: (name: string) => CookieValue;
  set: (name: string, value: string, options: typeof LANG_COOKIE_OPTIONS) => void;
};

/**
 * Resolve language from query param/cookie and persist query language to cookie.
 * Invalid values fall back to default language.
 */
export function resolvePageLang(url: URL, cookies: CookieStore, defaultLang = 1): number {
  const langParam = url.searchParams.get("lang");
  const cookieLang = cookies.get("lang")?.value ?? null;
  const lang = getLangParam(langParam ?? cookieLang, defaultLang);

  if (langParam !== null) {
    cookies.set("lang", String(getLangParam(langParam, defaultLang)), LANG_COOKIE_OPTIONS);
  }

  return lang;
}
