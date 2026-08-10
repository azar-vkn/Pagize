import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { getEvent, getHeader, setCookie } from "vinxi/http";

export const createClient = () => {
  return createServerClient(
    process.env['VITE_SUPABASE_URL']!,
    process.env['VITE_SUPABASE_ANON_KEY']!,
    {
      cookies: {
        getAll() {
          const event = getEvent();
          const cookieHeader = getHeader(event, 'cookie') as string | undefined;
          return parseCookieHeader(cookieHeader ?? '');
        },
        setAll(cookiesToSet) {
          try {
            const event = getEvent();
            cookiesToSet.forEach(({ name, value, options }) => {
              setCookie(event, name, value, options);
            });
          } catch {
            // Ignore if called from a place that can't set cookies (e.g. during SSR render instead of Server Function)
          }
        },
      },
    }
  );
};
