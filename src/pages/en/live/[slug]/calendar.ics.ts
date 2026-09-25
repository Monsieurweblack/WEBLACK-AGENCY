import type { APIRoute } from "astro";
import { getLiveEntries } from "../../../../lib/content";
import { buildIcsEvent } from "../../../../lib/live-calendar";

export async function getStaticPaths() {
  const entries = await getLiveEntries("en");
  return entries.filter((live) => live.scheduledStart).map((live) => ({ params: { slug: live.slug }, props: { live } }));
}

export const GET: APIRoute = ({ props, site }) => {
  const live = props.live as Awaited<ReturnType<typeof getLiveEntries>>[number];
  const url = new URL(`/en/live/${live.slug}/`, site ?? "https://weblack.fr").toString();
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
