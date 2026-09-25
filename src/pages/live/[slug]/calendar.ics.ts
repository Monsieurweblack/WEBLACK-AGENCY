import type { APIRoute } from "astro";
import { getLiveEntries } from "../../../lib/content";
import { buildIcsEvent } from "../../../lib/live-calendar";

/**
 * Un fichier .ics par diffusion programmée — généré au build, comme tout le
 * reste du site (sortie statique, sans adaptateur SSR). Aucune diffusion
 * sans scheduledStart n'a de fichier : rien à mettre dans un calendrier pour
 * un replay ou un live sans date.
 */
export async function getStaticPaths() {
  const entries = await getLiveEntries("fr");
  return entries.filter((live) => live.scheduledStart).map((live) => ({ params: { slug: live.slug }, props: { live } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const live = props.live as Awaited<ReturnType<typeof getLiveEntries>>[number];
  const url = new URL(`/live/${live.slug}/`, site ?? "https://weblack.fr").toString();
  const ics = buildIcsEvent(
    {
      title: live.title,
      description: live.description,
      location: live.location,
      url,
      scheduledStart: live.scheduledStart!,
      scheduledEnd: live.scheduledEnd,
    },
    `${live.id}@weblack.fr`,
  );
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${live.slug}.ics"`,
    },
  });
};
