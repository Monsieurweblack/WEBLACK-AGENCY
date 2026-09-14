import { createClient, type SanityClient } from "@sanity/client";
import { loadConfig } from "../config/env.ts";

let client: SanityClient | undefined;

/**
 * The engine writes with SANITY_WRITE_TOKEN only — the same "editor"-role
 * token `src/lib/content.ts` already trusts for content operations. It
 * never touches SANITY_DEPLOY_TOKEN (deploy/schema grants), which stays
 * reserved for Studio deploys, matching the separation already established
 * for this project.
 */
export function getSanityClient(): SanityClient {
  if (client) return client;
  const config = loadConfig();
  client = createClient({
    projectId: config.sanityProjectId,
    dataset: config.sanityDataset,
    apiVersion: "2025-01-01",
    token: config.sanityWriteToken,
    useCdn: false, // writes and the read-before-write duplicate checks must see live data
  });
  return client;
}
