// Testes do adaptador Google Gemini e da camada de provedores (fetch simulado).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  montarRequisicaoGemini,
  enviarMensagemGemini,
  paraContents,
  suportaThinkingLevel,
  AcumuladorGemini,
  MODELO_PADRAO_GEMINI,
} from "../lib/gemini.js";
import { ErroApi } from "../lib/anthropic.js";
import { enviarConversa, paraMensagensAnthropic, chaveDe, modeloDe, provedorDe } from "../lib/provedores.js";
import { PADROES } from "../lib/config.js";

function streamDe(pedacos) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of pedacos) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}
const chunk = (obj) => `data: ${JSON.stringify(obj)}\r\n\r\n`;
const parte = (text, extra = {}) => ({ candidates: [{ content: { role: "model", parts: [{ text, ...extra }] } }] });

const STREAM_GEMINI = [
  chunk(parte("## Conceito\n")),
  chunk(parte("Uma **pilha** é LIFO.")),
  chunk({
    candidates: [{ content: { role: "model", parts: [{ text: "", thoughtSignature: "SIG-G1" }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 50, totalTokenCount: 200 },
    modelVersion: "gemini-3.8-flash",
  }),
];

const HISTORICO = [
  { role: "user", content: "Pergunta 1" },
  { role: "assistant", provedor: "gemini", content: [{ text: "Resp G", thoughtSignature: "SIG-X" }], texto: "Resp G" },
  { role: "user", content: "Pergunta 2" },
  { role: "assistant", provedor: "anthropic", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "Resp C" }], texto: "Resp C" },
  { role: "user", content: "Pergunta 3" },
];

test("Gemini: endpoint de streaming, chave no cabeçalho (fora da URL) e corpo no formato da API", () => {
  const { url, init } = montarRequisicaoGemini({ apiKey: "CHAVE-G", esforco: "medium", system: "Você é tutor", messages: [{ role: "user", content: "oi" }] });
  assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_PADRAO_GEMINI}:streamGenerateContent?alt=sse`);
  assert.ok(!url.includes("CHAVE-G"), "a chave não pode ir na URL");
  assert.equal(init.headers["x-goog-api-key"], "CHAVE-G");
  const body = JSON.parse(init.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: "Você é tutor" }] });
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "oi" }] }]);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: "MEDIUM" });
  assert.ok(body.generationConfig.maxOutputTokens > 0);
  assert.ok(!("temperature" in body.generationConfig));
});

test("Gemini: modelo opcional, esforço mapeado e thinkingLevel só no Gemini 3+", () => {
  const alto = JSON.parse(montarRequisicaoGemini({ apiKey: "k", modelo: "gemini-3.5-flash-lite", esforco: "high", messages: [] }).init.body);
  assert.equal(alto.generationConfig.thinkingConfig.thinkingLevel, "HIGH");
  const antigo = montarRequisicaoGemini({ apiKey: "k", modelo: "gemini-2.5-flash", esforco: "low", messages: [] });
  assert.ok(antigo.url.includes("/gemini-2.5-flash:"));
  assert.ok(!("thinkingConfig" in JSON.parse(antigo.init.body).generationConfig));
  assert.equal(suportaThinkingLevel("gemini-3.8-flash"), true);
  assert.equal(suportaThinkingLevel("gemini-2.5-flash"), false);
  assert.throws(() => montarRequisicaoGemini({ apiKey: "k", modelo: "../x?y", messages: [] }), /inválido/);
  assert.throws(() => montarRequisicaoGemini({ apiKey: "", messages: [] }), (e) => e instanceof ErroApi && e.tipo === "sem_chave");
});

test("Gemini: histórico vira contents user/model; turnos do Gemini voltam com thoughtSignature", () => {
  const c = paraContents(HISTORICO);
  assert.deepEqual(c.map((x) => x.role), ["user", "model", "user", "model", "user"]);
  assert.deepEqual(c[1].parts, [{ text: "Resp G", thoughtSignature: "SIG-X" }]);
  assert.deepEqual(c[3].parts, [{ text: "Resp C" }], "turno do Claude vira texto simples");
});

test("Claude: turnos do Gemini viram texto; turnos do Claude (e antigos sem provedor) voltam intactos", () => {
  const m = paraMensagensAnthropic([...HISTORICO, { role: "assistant", content: [{ type: "text", text: "v1.0" }] }]);
  assert.deepEqual(m[1], { role: "assistant", content: [{ type: "text", text: "Resp G" }] });
  assert.equal(m[3].content[0].signature, "s");
  assert.ok(m.every((x) => Object.keys(x).sort().join() === "content,role"), "só role + content vão para a Anthropic");
  assert.deepEqual(m[5].content, [{ type: "text", text: "v1.0" }]);
});

test("Gemini: stream SSE é juntado, assinatura preservada e uso contado", async () => {
  const deltas = [];
  const r = await enviarMensagemGemini(
    { apiKey: "k", system: "s", messages: [{ role: "user", content: "x" }] },
    { fetchFn: async () => new Response(streamDe(STREAM_GEMINI)), onTexto: (t) => deltas.push(t) }
  );
  assert.equal(r.texto(), "## Conceito\nUma **pilha** é LIFO.");
  assert.deepEqual(deltas, ["## Conceito\n", "Uma **pilha** é LIFO."]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.parts)), [{ text: "## Conceito\nUma **pilha** é LIFO.", thoughtSignature: "SIG-G1" }]);
  assert.equal(r.finishReason, "STOP");
  assert.equal(r.usage.input_tokens, 120);
  assert.equal(r.usage.output_tokens, 80, "saída inclui tokens de raciocínio");
  assert.equal(r.modelo, "gemini-3.8-flash");
  assert.equal(r.motivoRecusa(), null);
});

test("Gemini: partes de raciocínio (thought) não aparecem no texto mas ficam no histórico", () => {
  const acc = new AcumuladorGemini("m");
  acc.aplicar({ candidates: [{ content: { parts: [{ text: "pensando...", thought: true }, { text: "Resposta" }] } }] });
  assert.equal(acc.texto(), "Resposta");
  assert.equal(acc.parts.length, 2);
});

test("Gemini: bloqueio de segurança vira recusa com motivo em português", async () => {
  const s1 = [chunk({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } })];
  const r1 = await enviarMensagemGemini({ apiKey: "k", messages: [] }, { fetchFn: async () => new Response(streamDe(s1)) });
  assert.match(r1.motivoRecusa(), /proibido/);
  const s2 = [chunk({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })];
  const r2 = await enviarMensagemGemini({ apiKey: "k", messages: [] }, { fetchFn: async () => new Response(streamDe(s2)) });
  assert.match(r2.motivoRecusa(), /segurança/);
});

for (const [status, erro, esperado] of [
  [400, { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." }, /Chave do Gemini inválida/],
  [401, { code: 401, status: "UNAUTHENTICATED", message: "" }, /Chave do Gemini inválida/],
  [403, { code: 403, status: "PERMISSION_DENIED", message: "Your API key was reported as leaked." }, /exposta publicamente/],
  [403, { code: 403, status: "PERMISSION_DENIED", message: "Method doesn't allow unregistered callers" }, /não tem permissão/],
  [429, { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" }, /plano gratuito[\s\S]*1 minuto[\s\S]*Brasília/],
  [404, { code: 404, status: "NOT_FOUND", message: "models/x is not found" }, /Modelo do Gemini não encontrado/],
  [400, { code: 400, status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." }, /região/],
  [503, { code: 503, status: "UNAVAILABLE", message: "The model is overloaded." }, /sobrecarregado/],
  [400, { code: 400, status: "INVALID_ARGUMENT", message: "Invalid value at contents" }, /Requisição inválida para o Gemini: Invalid value/],
]) {
  test(`Gemini: HTTP ${status} ${erro.status} → mensagem em português`, async () => {
    const fetchFn = async () => new Response(JSON.stringify({ error: erro }), { status });
    await assert.rejects(enviarMensagemGemini({ apiKey: "k", messages: [] }, { fetchFn }), (e) => {
      assert.ok(e instanceof ErroApi);
      assert.equal(e.status, status);
      assert.match(e.message, esperado);
      return true;
    });
  });
}

test("Gemini: corpo de erro em array (formato de alguns erros do stream) também é lido", async () => {
  const fetchFn = async () => new Response(JSON.stringify([{ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "q" } }]), { status: 429 });
  await assert.rejects(enviarMensagemGemini({ apiKey: "k", messages: [] }, { fetchFn }), /plano gratuito/);
});

test("Gemini: erro no meio do stream e falha de rede", async () => {
  const s = [chunk(parte("começo")), chunk({ error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } })];
  await assert.rejects(enviarMensagemGemini({ apiKey: "k", messages: [] }, { fetchFn: async () => new Response(streamDe(s)) }), /sobrecarregado/);
  const semRede = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(enviarMensagemGemini({ apiKey: "k", messages: [] }, { fetchFn: semRede }), /Sem conexão com a API do Google Gemini/);
});

test("provedores: Gemini é o padrão, cada provedor usa a própria chave e modelo", () => {
  assert.equal(PADROES.provedor, "gemini");
  const cfg = { ...PADROES, geminiKey: " G ", apiKey: "sk-ant-A" };
  assert.equal(provedorDe(cfg), "gemini");
  assert.equal(chaveDe(cfg), "G");
  assert.equal(modeloDe(cfg), MODELO_PADRAO_GEMINI);
  assert.equal(modeloDe({ ...cfg, modeloGemini: "gemini-3.5-flash-lite" }), "gemini-3.5-flash-lite");
  const claude = { ...cfg, provedor: "anthropic" };
  assert.equal(chaveDe(claude), "sk-ant-A");
  assert.equal(modeloDe(claude), "claude-opus-5-5");
  assert.equal(provedorDe({ provedor: "xyz" }), "gemini");
});

test("provedores: enviarConversa com Gemini devolve formato neutro e turno guardável", async () => {
  let pedido;
  const r = await enviarConversa(
    { config: { ...PADROES, geminiKey: "G" }, system: "s", messages: HISTORICO },
    {
      fetchFn: async (url, init) => {
        pedido = { url, init };
        return new Response(streamDe(STREAM_GEMINI));
      },
    }
  );
  assert.ok(pedido.url.includes("generativelanguage.googleapis.com"));
  assert.equal(JSON.parse(pedido.init.body).contents.length, 5);
  assert.equal(r.fim, "ok");
  assert.equal(r.texto, "## Conceito\nUma **pilha** é LIFO.");
  assert.deepEqual(r.uso, { entrada: 120, saida: 80 });
  assert.equal(r.turno.provedor, "gemini");
  assert.equal(r.turno.texto, r.texto);
  assert.equal(JSON.parse(JSON.stringify(r.turno)).content[0].thoughtSignature, "SIG-G1", "turno sobrevive à serialização do storage");
});

test("provedores: enviarConversa com Claude continua funcionando", async () => {
  const sse = (ev, d) => `event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`;
  const s = [
    sse("message_start", { type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 9 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Oi" } }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 3 } }),
  ];
  let pedido;
  const r = await enviarConversa(
    { config: { ...PADROES, provedor: "anthropic", apiKey: "sk-ant-x" }, system: "s", messages: HISTORICO },
    {
      fetchFn: async (url, init) => {
        pedido = { url, body: JSON.parse(init.body) };
        return new Response(streamDe(s));
      },
    }
  );
  assert.equal(pedido.url, "https://api.anthropic.com/v1/messages");
  assert.deepEqual(pedido.body.messages[1], { role: "assistant", content: [{ type: "text", text: "Resp G" }] });
  assert.equal(r.fim, "limite");
  assert.equal(r.texto, "Oi");
  assert.equal(r.turno.provedor, "anthropic");
});
