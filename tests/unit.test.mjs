// Rode com: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  montarRequisicao,
  lerSSE,
  AcumuladorDeResposta,
  enviarMensagem,
  ErroApi,
  suportaFallback,
  API_VERSION,
} from "../lib/anthropic.js";
import { renderizarMarkdown } from "../lib/markdown.js";
import { mensagemInicial, mensagemMaisDica, promptDoSistema } from "../lib/prompts.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

function streamDe(pedacos) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of pedacos) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const STREAM_OK = [
  sse("message_start", { type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 50, output_tokens: 1 } } }),
  sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
  sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig123" } }),
  sse("content_block_stop", { type: "content_block_stop", index: 0 }),
  sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
  sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "## Conceito\n" } }),
  sse("ping", { type: "ping" }),
  sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Olá **mundo**" } }),
  sse("content_block_stop", { type: "content_block_stop", index: 1 }),
  sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } }),
  sse("message_stop", { type: "message_stop" }),
];

test("montarRequisicao: cabeçalhos, effort e fallback padrão no Opus 5.5", () => {
  const { url, init } = montarRequisicao({
    apiKey: "sk-ant-teste",
    modelo: "claude-opus-5-5",
    esforco: "medium",
    system: "s",
    messages: [{ role: "user", content: "oi" }],
  });
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], "sk-ant-teste");
  assert.equal(init.headers["anthropic-version"], API_VERSION);
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  const body = JSON.parse(init.body);
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.stream, true);
  assert.equal(body.fallbacks, "default");
  assert.deepEqual(body.output_config, { effort: "medium" });
  assert.ok(!("thinking" in body), "Opus 5.5: thinking deve ser omitido (sempre adaptativo)");
  assert.ok(!("temperature" in body), "temperature é rejeitado na API 2026-10-21");
});

test("montarRequisicao: Haiku 5.5 não envia fallbacks", () => {
  const { init } = montarRequisicao({ apiKey: "k", modelo: "claude-haiku-5-5", system: "", messages: [] });
  assert.ok(!("anthropic-beta" in init.headers));
  assert.ok(!("fallbacks" in JSON.parse(init.body)));
  assert.equal(suportaFallback("claude-sonnet-5-5"), true);
});

test("montarRequisicao: sem chave gera erro amigável", () => {
  assert.throws(() => montarRequisicao({ apiKey: "", messages: [] }), (e) => e instanceof ErroApi && e.tipo === "sem_chave");
});

test("lerSSE: funciona com eventos quebrados no meio dos pacotes e CRLF", async () => {
  const tudo = STREAM_OK.join("").replace(/\n/g, "\r\n");
  const pedacos = [];
  for (let i = 0; i < tudo.length; i += 7) pedacos.push(tudo.slice(i, i + 7));
  const eventos = [];
  for await (const ev of lerSSE(streamDe(pedacos))) eventos.push(ev);
  assert.equal(eventos.length, STREAM_OK.length);
  assert.equal(eventos[0].event, "message_start");
  assert.equal(eventos.at(-1).data.type, "message_stop");
});

test("AcumuladorDeResposta: texto, assinatura do thinking e uso", async () => {
  const acc = new AcumuladorDeResposta();
  const deltas = [];
  for await (const ev of lerSSE(streamDe(STREAM_OK))) acc.aplicar(ev, { onTexto: (t) => deltas.push(t) });
  assert.equal(acc.texto(), "## Conceito\nOlá **mundo**");
  assert.deepEqual(deltas, ["## Conceito\n", "Olá **mundo**"]);
  assert.equal(acc.stopReason, "end_turn");
  assert.equal(acc.usage.input_tokens, 50);
  assert.equal(acc.usage.output_tokens, 42);
  const hist = acc.conteudoParaHistorico();
  assert.equal(hist.length, 2);
  assert.deepEqual(hist[0], { type: "thinking", thinking: "", signature: "sig123" }, "thinking volta intacto ao histórico");
});

test("AcumuladorDeResposta: evento de erro no meio do stream vira ErroApi traduzido", () => {
  const acc = new AcumuladorDeResposta();
  assert.throws(
    () => acc.aplicar({ event: "error", data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }),
    (e) => e instanceof ErroApi && /sobrecarregada/.test(e.message)
  );
});

test("enviarMensagem: stream completo via fetch simulado", async () => {
  let pedido;
  const fetchFn = async (url, init) => {
    pedido = { url, init };
    return new Response(streamDe(STREAM_OK), { status: 200 });
  };
  const r = await enviarMensagem({ apiKey: "k", modelo: "claude-opus-5-5", system: "s", messages: [{ role: "user", content: "x" }] }, { fetchFn });
  assert.equal(r.texto(), "## Conceito\nOlá **mundo**");
  assert.equal(pedido.init.method, "POST");
});

test("enviarMensagem: recusa (refusal) é exposta em stopReason", async () => {
  const s = [
    sse("message_start", { type: "message_start", message: { usage: { input_tokens: 5 } } }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } } }),
  ];
  const r = await enviarMensagem({ apiKey: "k", system: "", messages: [] }, { fetchFn: async () => new Response(streamDe(s)) });
  assert.equal(r.stopReason, "refusal");
  assert.equal(r.stopDetails.category, "cyber");
});

for (const [status, tipo, esperado] of [
  [401, "authentication_error", /Chave de API inválida/],
  [404, "not_found_error", /Modelo não encontrado/],
  [429, "rate_limit_error", /Limite de uso/],
  [529, "overloaded_error", /sobrecarregada/],
  [400, "invalid_request_error", /Requisição inválida: campo x/],
]) {
  test(`enviarMensagem: HTTP ${status} vira mensagem em português`, async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ type: "error", error: { type: tipo, message: "campo x" } }), { status });
    await assert.rejects(enviarMensagem({ apiKey: "k", system: "", messages: [] }, { fetchFn }), (e) => {
      assert.ok(e instanceof ErroApi);
      assert.equal(e.status, status);
      assert.match(e.message, esperado);
      return true;
    });
  });
}

test("enviarMensagem: falha de rede", async () => {
  const fetchFn = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(enviarMensagem({ apiKey: "k", system: "", messages: [] }, { fetchFn }), /Sem conexão/);
});

test("markdown: escapa HTML (sem XSS) e formata o básico", () => {
  const h = renderizarMarkdown('## Título\n<img src=x onerror="alert(1)">\n**negrito** e `<b>code</b>`\n\n- a\n- b\n\n1. um\n2. dois\n\n```js\nif (a < b) {}\n```');
  assert.ok(!h.includes("<img"), "tag img deve ser escapada");
  assert.ok(h.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(h.includes("<h3>Título</h3>"));
  assert.ok(h.includes("<strong>negrito</strong>"));
  assert.ok(h.includes("<code>&lt;b&gt;code&lt;/b&gt;</code>"));
  assert.ok(h.includes("<ul><li>a</li><li>b</li></ul>"));
  assert.ok(h.includes("<ol><li>um</li><li>dois</li></ol>"));
  assert.ok(h.includes('<pre data-lang="js"><code>if (a &lt; b) {}</code></pre>'));
});

test("markdown: bloco de código ainda aberto (durante o streaming) não quebra", () => {
  const h = renderizarMarkdown("Veja:\n```python\nprint('oi')");
  assert.ok(h.includes("<pre"));
  assert.ok(h.includes("print(&#39;oi&#39;)"));
});

test("prompts: modo dica pede para NÃO revelar a resposta", () => {
  const m = mensagemInicial({ pergunta: "Quanto é 2+2? a) 3 b) 4", modo: "dica" });
  assert.match(m, /<pergunta>[\s\S]*2\+2[\s\S]*<\/pergunta>/);
  assert.match(m, /NÃO revele a resposta/);
  assert.match(mensagemMaisDica(2), /SEM revelar/);
  const c = mensagemInicial({ pergunta: "x", modo: "completo" });
  assert.match(c, /Análise das alternativas/);
  assert.match(promptDoSistema({ perfil: "estudante de ADS" }), /estudante de ADS/);
});

// Garantia ética: nenhum código da extensão interage com formulários da página.
test("ética: o código não clica, marca, digita nem envia nada nas páginas", () => {
  const arquivos = [];
  const andar = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (!["tests", "tools", "node_modules"].includes(n)) andar(p);
      } else if (p.endsWith(".js")) arquivos.push(p);
    }
  };
  andar(raiz);
  const proibidos = [/\.click\(\)/, /\.checked\s*=/, /\.submit\(/, /requestSubmit/, /dispatchEvent/, /\.value\s*=.*document\.querySelector/];
  const injetados = ["lib/detectar.js", "background.js"].map((f) => readFileSync(join(raiz, f), "utf8"));
  for (const src of injetados) for (const re of proibidos) assert.ok(!re.test(src), `padrão proibido ${re} encontrado`);
  // E nenhuma chave de API embutida no código.
  for (const f of arquivos) assert.ok(!/sk-ant-[A-Za-z0-9_-]{20,}/.test(readFileSync(f, "utf8")), `possível chave embutida em ${f}`);
});

test("manifest: MV3 válido e arquivos referenciados existem", () => {
  const m = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
  assert.equal(m.manifest_version, 3);
  const caminhos = [m.background.service_worker, m.side_panel.default_path, m.options_page, ...Object.values(m.icons)];
  for (const c of caminhos) assert.ok(statSync(join(raiz, c)).isFile(), c);
  assert.deepEqual(m.host_permissions, ["https://generativelanguage.googleapis.com/*", "https://api.anthropic.com/*"]);
});
