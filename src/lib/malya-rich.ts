/**
 * Rendu riche SÛR des réponses de MALYA : titres, listes, gras et marqueurs de sources [S#] construits en DOM
 * avec textContent uniquement. Le texte venu du modèle n'est JAMAIS interprété comme du HTML.
 */
function inline(target: HTMLElement, text: string) {
  // **gras** et [S1] ; tout le reste reste du texte brut.
  const re = /\*\*([^*\n]+)\*\*|\[S(\d+)\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) target.append(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      const b = document.createElement("strong");
      b.textContent = m[1];
      target.append(b);
    } else {
      const s = document.createElement("sup");
      s.textContent = `[${m[2]}]`;
      s.setAttribute("aria-label", `source ${m[2]}`);
      target.append(s);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) target.append(document.createTextNode(text.slice(last)));
}

export function renderRich(container: HTMLElement, text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  let para: string[] = [];
  let list: { el: HTMLUListElement | HTMLOListElement; ordered: boolean } | null = null;
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    inline(p, para.join(" ").trim());
    container.append(p);
    para = [];
  };
  const flushList = () => { list = null; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (heading) { flushPara(); flushList(); const h = document.createElement("h3"); inline(h, heading[1]); container.append(h); continue; }
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        list = { el: document.createElement(ordered ? "ol" : "ul"), ordered };
        container.append(list.el);
      }
      const li = document.createElement("li");
      inline(li, (bullet ?? numbered)![1]);
      list.el.append(li);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw) && list.el.lastElementChild) { inline(list.el.lastElementChild as HTMLElement, " " + line.trim()); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
}
