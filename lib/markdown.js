// Renderizador de Markdown pequeno e seguro: TODO texto é escapado antes de
// receber formatação, então nenhum HTML vindo da IA ou da página é executado.

export function escaparHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(texto) {
  // Separa código inline primeiro para não formatar dentro dele.
  const partes = String(texto).split(/(`[^`\n]+`)/g);
  return partes
    .map((p) => {
      if (/^`[^`\n]+`$/.test(p)) return `<code>${escaparHtml(p.slice(1, -1))}</code>`;
      let h = escaparHtml(p);
      h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      h = h.replace(/__(.+?)__/g, "<strong>$1</strong>");
      h = h.replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, "$1<em>$2</em>");
      h = h.replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?![_\w])/g, "$1<em>$2</em>");
      return h;
    })
    .join("");
}

export function renderizarMarkdown(md) {
  const linhas = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let paragrafo = [];

  const fecharParagrafo = () => {
    if (paragrafo.length) {
      out.push(`<p>${paragrafo.map(inline).join("<br>")}</p>`);
      paragrafo = [];
    }
  };

  while (i < linhas.length) {
    const linha = linhas[i];

    // Bloco de código cercado ```
    const cerca = linha.match(/^\s*```\s*([\w+#.-]*)\s*$/);
    if (cerca) {
      fecharParagrafo();
      const codigo = [];
      i++;
      while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) codigo.push(linhas[i++]);
      i++; // pula a cerca de fechamento (ou o fim)
      const lang = cerca[1] ? ` data-lang="${escaparHtml(cerca[1])}"` : "";
      out.push(`<pre${lang}><code>${escaparHtml(codigo.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(linha)) {
      fecharParagrafo();
      i++;
      continue;
    }

    const titulo = linha.match(/^(#{1,6})\s+(.*)$/);
    if (titulo) {
      fecharParagrafo();
      const nivel = Math.min(titulo[1].length + 1, 6); // # vira h2 (o painel já tem h1)
      out.push(`<h${nivel}>${inline(titulo[2].replace(/\s+#+\s*$/, ""))}</h${nivel}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(linha)) {
      fecharParagrafo();
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\s*>/.test(linha)) {
      fecharParagrafo();
      const citacao = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) citacao.push(linhas[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${renderizarMarkdown(citacao.join("\n"))}</blockquote>`);
      continue;
    }

    const item = linha.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      fecharParagrafo();
      const ordenada = /\d/.test(item[2]);
      const tag = ordenada ? "ol" : "ul";
      const inicio = ordenada ? parseInt(item[2], 10) : 1;
      const itens = [];
      while (i < linhas.length) {
        const m = linhas[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[2]) === ordenada && m[1].length <= item[1].length + 1) {
          itens.push(m[3]);
          i++;
        } else if (m || (linhas[i].match(/^\s{2,}\S/) && itens.length)) {
          // sub-item ou continuação: anexa ao item atual
          itens[itens.length - 1] += "\n" + linhas[i].trim();
          i++;
        } else break;
      }
      const attrInicio = ordenada && inicio !== 1 ? ` start="${inicio}"` : "";
      out.push(
        `<${tag}${attrInicio}>${itens.map((t) => `<li>${t.split("\n").map(inline).join("<br>")}</li>`).join("")}</${tag}>`
      );
      continue;
    }

    paragrafo.push(linha.trim());
    i++;
  }
  fecharParagrafo();
  return out.join("\n");
}
