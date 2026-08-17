let initialized = false;

export function initLazyVideoEmbeds() {
  if (initialized) return;
  initialized = true;

  document.querySelectorAll<HTMLElement>("[data-youtube-wrap]").forEach((wrap) => {
    const trigger = wrap.querySelector<HTMLButtonElement>("[data-youtube-trigger]");
    trigger?.addEventListener("click", () => {
      const id = wrap.dataset.youtubeId;
      if (!id) return;
      const title = wrap.dataset.youtubeTitle ?? "";
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
      iframe.title = title;
      iframe.className = "h-full w-full";
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      wrap.replaceChildren(iframe);
    });
  });
}
