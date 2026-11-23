import { getEntriesByLang } from "../../../lib/content";
import { journalRss } from "../../../lib/rss";
import { useTranslations } from "../../../i18n/utils";

export async function GET() {
  const lang = "en" as const;
  const t = useTranslations(lang);
  const entries = await getEntriesByLang("journal", lang);
  return new Response(journalRss(entries, lang, t("journal.seo.title"), t("journal.seo.description")), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
