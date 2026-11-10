// Cliente mínimo da API de Mensagens da Anthropic (HTTP direto + streaming SSE).
//
// Por que HTTP direto e não o SDK oficial? A extensão é carregada "sem compactação",
// sem etapa de build (npm/bundler). O SDK precisaria ser empacotado. Aqui usamos o
// mesmo contrato REST documentado (POST /v1/messages com stream: true).

export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2026-10-21";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export const MODELOS = [
  { id: "claude-opus-5-5", nome: "Claude Opus 5.5 (recomendado, melhor explicação)" },
  { id: "claude-sonnet-5-5", nome: "Claude Sonnet 5.5 (mais rápido e barato)" },
  { id: "claude-haiku-5-5", nome: "Claude Haiku 5.5 (o mais barato)" },
];
export const MODELO_PADRAO = "claude-opus-5-5";
export const ESFORCOS = ["low", "medium", "high"];
export const ESFORCO_PADRAO = "medium";

// Fallback no servidor (refazer em outro modelo se o filtro de segurança recusar
// por engano). O Haiku 5.5 não tem fallback no servidor.
export function suportaFallback(modelo) {
  return /^claude-(opus-5-5|sonnet-5-5|fable-5-1)$/.test(modelo);
}

export class ErroApi extends Error {
  constructor(mensagem, { status = 0, tipo = "", detalhe = "" } = {}) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.tipo = tipo;
    this.detalhe = detalhe;
  }
}

export function montarRequisicao({ apiKey, modelo, esforco, system, messages, maxTokens = 64000 }) {
  if (!apiKey) throw new ErroApi("Chave de API não configurada. Abra as Opções da extensão.", { tipo: "sem_chave" });
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    // Necessário para chamar a API a partir de um navegador/extensão.
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const body = {
    model: modelo || MODELO_PADRAO,
    max_tokens: maxTokens,
    stream: true,
    system,
    messages,
    output_config: { effort: esforco || ESFORCO_PADRAO },
  };
  if (suportaFallback(body.model)) {
    headers["anthropic-beta"] = FALLBACK_BETA;
    body.fallbacks = "default";
  }
  return { url: API_URL, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

// Lê um ReadableStream de bytes e produz eventos SSE { event, data }.
export async function* lerSSE(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const bloco = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = interpretarBloco(bloco);
        if (ev) yield ev;
      }
    }
    buffer += decoder.decode();
    const ev = interpretarBloco(buffer.replace(/\r\n/g, "\n").trim());
    if (ev) yield ev;
  } finally {
    reader.releaseLock();
  }
}

function interpretarBloco(bloco) {
  if (!bloco) return null;
  let event = "message";
  const dados = [];
  for (const linha of bloco.split("\n")) {
    if (linha.startsWith(":")) continue;
    if (linha.startsWith("event:")) event = linha.slice(6).trim();
    else if (linha.startsWith("data:")) dados.push(linha.slice(5).replace(/^ /, ""));
  }
  if (!dados.length) return null;
  const texto = dados.join("\n");
  try {
    return { event, data: JSON.parse(texto) };
  } catch {
    return { event, data: texto };
  }
}

// Reconstrói os blocos de conteúdo da resposta a partir dos eventos do stream.
// Guardamos TODOS os blocos (inclusive "thinking" com assinatura) para devolvê-los
// intactos nas próximas mensagens da conversa, como a API exige.
export class AcumuladorDeResposta {
  constructor() {
    this.content = [];
    this.stopReason = null;
    this.stopDetails = null;
    this.usage = { input_tokens: 0, output_tokens: 0 };
    this.modelo = null;
  }

  aplicar({ event, data }, { onTexto } = {}) {
    const tipo = (data && data.type) || event;
    switch (tipo) {
      case "message_start": {
        const m = data.message || {};
        this.modelo = m.model || null;
        if (m.usage) Object.assign(this.usage, m.usage);
        break;
      }
      case "content_block_start": {
        this.content[data.index] = structuredCloneSeguro(data.content_block);
        break;
      }
      case "content_block_delta": {
        const bloco = this.content[data.index];
        const d = data.delta || {};
        if (!bloco) break;
        if (d.type === "text_delta") {
          bloco.text = (bloco.text || "") + d.text;
          if (onTexto) onTexto(d.text);
        } else if (d.type === "thinking_delta") {
          bloco.thinking = (bloco.thinking || "") + d.thinking;
        } else if (d.type === "signature_delta") {
          bloco.signature = (bloco.signature || "") + d.signature;
        } else if (d.type === "citations_delta") {
          (bloco.citations ||= []).push(d.citation);
        }
        break;
      }
      case "message_delta": {
        if (data.delta) {
          if ("stop_reason" in data.delta) this.stopReason = data.delta.stop_reason;
          if (data.delta.stop_details) this.stopDetails = data.delta.stop_details;
        }
        if (data.usage) Object.assign(this.usage, data.usage);
        break;
      }
      case "error": {
        const e = (data && data.error) || {};
        throw new ErroApi(traduzirErro(e.type, 0, e.message), { tipo: e.type, detalhe: e.message });
      }
      default:
        break; // ping, content_block_stop, message_stop...
    }
  }

  texto() {
    return this.content
      .filter((b) => b && b.type === "text")
      .map((b) => b.text || "")
      .join("");
  }

  // Conteúdo a devolver como turno "assistant" na próxima requisição.
  conteudoParaHistorico() {
    return this.content.filter(Boolean);
  }
}

function structuredCloneSeguro(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

export function traduzirErro(tipo, status, mensagem = "") {
  const t = tipo || "";
  if (status === 401 || t === "authentication_error")
    return "Chave de API inválida. Confira a chave nas Opções da extensão.";
  if (status === 403 || t === "permission_error")
    return "Sua chave não tem permissão para este modelo ou recurso.";
  if (status === 404 || t === "not_found_error")
    return "Modelo não encontrado para esta chave. Tente outro modelo nas Opções.";
  if (status === 429 || t === "rate_limit_error")
    return "Limite de uso atingido. Espere um pouco e tente de novo.";
  if (status === 529 || t === "overloaded_error")
    return "A API está sobrecarregada no momento. Tente novamente em instantes.";
  if (t === "billing_error" || /credit|billing/i.test(mensagem))
    return "Problema de créditos/cobrança na conta da API. Verifique o console da Anthropic.";
  if (status >= 500 || t === "api_error") return "Erro temporário no servidor da API. Tente novamente.";
  if (status === 400 || t === "invalid_request_error") return "Requisição inválida: " + (mensagem || "verifique a configuração.");
  return mensagem || "Erro desconhecido ao chamar a API.";
}

// Faz uma chamada com streaming. Devolve o acumulador com a resposta completa.
export async function enviarMensagem(opcoes, { onTexto, signal, fetchFn = fetch } = {}) {
  const { url, init } = montarRequisicao(opcoes);
  let resp;
  try {
    resp = await fetchFn(url, { ...init, signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new ErroApi("Sem conexão com a API da Anthropic. Verifique sua internet.", { tipo: "rede", detalhe: String(e) });
  }
  if (!resp.ok) {
    let tipo = "";
    let msg = "";
    try {
      const j = await resp.json();
      tipo = j?.error?.type || "";
      msg = j?.error?.message || "";
    } catch {
      /* corpo não-JSON */
    }
    throw new ErroApi(traduzirErro(tipo, resp.status, msg), { status: resp.status, tipo, detalhe: msg });
  }
  const acc = new AcumuladorDeResposta();
  for await (const ev of lerSSE(resp.body)) acc.aplicar(ev, { onTexto });
  return acc;
}
