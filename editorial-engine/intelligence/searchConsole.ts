/**
 * §12 — Google Search Console readiness layer.
 *
 * NOT CONNECTED. There is no Search Console API credential anywhere in
 * this project (checked: no GOOGLE_* / GSC_* / service-account JSON in
 * .env or .env.example). This module defines the exact shape the rest of
 * the engine (see seo/feedbackLoop.ts) expects once a real connection
 * exists, and fails loudly rather than returning invented numbers.
 *
 * Google Analytics, by contrast, IS already live on the site (GA4 property
 * G-1Y2Q6BGRZ8, wired in src/layouts/BaseLayout.astro with a real consent
 * gate) — nothing to add there; this module doesn't touch it.
 *
 * To connect Search Console for real:
 *  1. Enable the Search Console API in the Google Cloud project already
 *     used for GA4 (or a new one).
 *  2. Create a service account, download its JSON key, and add that
 *     service account's email as a "Full" user on the weblack.fr property
 *     in Search Console (Settings -> Users and permissions).
 *  3. Set GOOGLE_SEARCH_CONSOLE_CREDENTIALS_JSON (the key file's content,
 *     as a single-line JSON string) and GOOGLE_SEARCH_CONSOLE_SITE_URL
 *     (e.g. "https://weblack.fr/" or "sc-domain:weblack.fr") in .env.
 *  4. Implement fetchSearchPerformance() below using
 *     googleapis's `searchconsole_v1` client
 *     (`client.searchanalytics.query(...)`) — deliberately not
 *     implemented here since it cannot be tested without real credentials,
 *     which this environment does not have.
 */
import { loadConfig } from "../config/env.ts";

export interface SearchPerformanceRow {
  page: string;
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleConfig {
  credentialsJson: string | undefined;
  siteUrl: string | undefined;
}

export function loadSearchConsoleConfig(): SearchConsoleConfig {
  const config = loadConfig();
  return {
    credentialsJson: config.googleSearchConsoleCredentialsJson,
    siteUrl: config.googleSearchConsoleSiteUrl,
  };
}

export function isSearchConsoleConnected(): boolean {
  const config = loadSearchConsoleConfig();
  return Boolean(config.credentialsJson && config.siteUrl);
}

/** Throws until real credentials are configured — never returns fabricated impressions/clicks/position. */
export async function fetchSearchPerformance(_sinceDate: string): Promise<SearchPerformanceRow[]> {
  if (!isSearchConsoleConnected()) {
    throw new Error(
      "Google Search Console non connecté (GOOGLE_SEARCH_CONSOLE_CREDENTIALS_JSON / GOOGLE_SEARCH_CONSOLE_SITE_URL absents de .env). Voir le docblock de ce fichier pour la procédure de connexion.",
    );
  }
  throw new Error(
    "Connexion Search Console détectée mais fetchSearchPerformance() n'est pas encore implémenté — nécessite googleapis et un vrai test contre l'API, non exécutable dans cet environnement.",
  );
}
