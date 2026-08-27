export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL;

  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL no está configurada.",
    );
  }

  if (!publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no está configurada.",
    );
  }

  let parsedUrl: URL;

  try {
    parsedUrl =
      new URL(url);
  } catch {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL no contiene una URL válida.",
    );
  }

  if (
    parsedUrl.protocol !== "http:" &&
    parsedUrl.protocol !== "https:"
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL debe utilizar HTTP o HTTPS.",
    );
  }

  return {
    url,
    publishableKey,
  };
}