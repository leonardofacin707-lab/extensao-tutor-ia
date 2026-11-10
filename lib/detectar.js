// Função injetada na página (chrome.scripting.executeScript) para LER a pergunta.
// Ela só lê texto: não clica, não marca alternativas e não altera nada na página.
// Precisa ser autocontida (sem referências externas), pois é serializada.

export function detectarPerguntaNaPagina() {
  const LIMITE = 6000;
  const limpar = (t) =>
    String(t || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, LIMITE);

  const pagina = { titulo: document.title || "", url: location.href };

  // 1) Texto selecionado tem prioridade.
  const sel = window.getSelection ? String(window.getSelection()) : "";
  if (sel.trim().length >= 3) return { texto: limpar(sel), origem: "selecao", pagina };

  // 2) Procura grupos de alternativas (radio/checkbox) visíveis na tela.
  const visivel = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const grupos = new Map();
  document.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]').forEach((el) => {
    const nome = el.getAttribute("name") || el.closest('[role="radiogroup"], fieldset, form')?.id || "_";
    if (!grupos.has(nome)) grupos.set(nome, []);
    grupos.get(nome).push(el);
  });

  const ancestralComum = (els) => {
    let anc = els[0].parentElement;
    while (anc && !els.every((e) => anc.contains(e))) anc = anc.parentElement;
    return anc;
  };

  let melhor = null;
  let melhorDist = Infinity;
  for (const els of grupos.values()) {
    if (els.length < 2) continue;
    let cont = ancestralComum(els);
    if (!cont) continue;
    // Se o contêiner só tem as alternativas, sobe alguns níveis até incluir o enunciado.
    const textoOpcoes = els.reduce((s, e) => s + ((e.closest("label") || e.parentElement)?.innerText || "").length, 0);
    const temEnunciado = (c) => (c.innerText || "").length - textoOpcoes > 30;
    for (let n = 0; n < 4 && !temEnunciado(cont) && cont.parentElement && cont.parentElement !== document.body; n++) {
      if ((cont.parentElement.innerText || "").length > LIMITE) break;
      cont = cont.parentElement;
    }
    if (!visivel(cont)) continue;
    const r = cont.getBoundingClientRect();
    const dist = Math.abs(r.top + r.height / 2 - innerHeight / 2);
    if (dist < melhorDist) {
      melhorDist = dist;
      melhor = cont;
    }
  }
  if (melhor) return { texto: limpar(melhor.innerText), origem: "alternativas", pagina };

  return { texto: "", origem: "nada", pagina };
}
