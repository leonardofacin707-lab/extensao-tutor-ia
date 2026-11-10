// Cliente mínimo da API Gemini (Google AI Studio), com streaming SSE.
// Endpoint: POST /v1beta/models/{modelo}:streamGenerateContent?alt=sse
// A chave vai no cabeçalho x-goog-api-key (fora da URL, para não aparecer em logs/histórico).

import { lerSSE, ErroApi } from "./anthropic.js";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
export const MODELO_PADRAO_GEMINI = "gemini-3.8-flash";
export const MODELOS_GEMINI = [
  { id: "gemini-3.8-flash", nome: "Gemini 3.8 Flash (padrão, grátis)" },
  { id: "gemini-3.5-flash-lite", nome: "Gemini 3.5 Flash-Lite (mais rápido, grátis)" },
  { id: "gemini-3.6-flash", nome: "Gemini 3.6 Flash (geração anterior)" },
];

// thinkingLevel só existe no Gemini 3 em diante (em modelos anteriores dá erro).
export function suportaThinkingLevel(modelo) {
  return /^gemini-([3-9]|\d{2,})/.test(modelo);
}

const NIVEL = { low: "LOW", medium: "MEDIUM", high: "HIGH" };

// Converte o histórico neutro da extensão para "contents" do Gemini.
// Turnos da IA gerados pelo próprio Gemini voltam intactos (com thoughtSignature);
// turnos vindos de outro provedor viram texto simples.
export function paraContents(messages) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", parts: [{ text: String(m.content) }] };
    if (m.provedor === "gemini" && Array.isArray(m.content)) return { role: "model", parts: m.content };
    return { role: "model", parts: [{ text: m.texto ?? textoDeConteudoAnthropic(m.content) }] };
  });
}

function textoDeConteudoAnthropic(content) {
  if (typeof content === "string") return content;
  return (content || []).filter((b) => b?.type === "text").map((b) => b.text).join("");
}

export function montarRequisicaoGemini({ apiKey, modelo, esforco, system, messages, maxTokens = 65536 }) {
  if (!apiKey) throw new ErroApi("Chave do Google Gemini não configurada. Abra as Opções da extensão.", { tipo: "sem_chave" });
  const m = (modelo || "").trim() || MODELO_PADRAO_GEMINI;
  if (!/^[\w.-]+$/.test(m)) throw new ErroApi(`Nome de modelo inválido: "${m}".`, { tipo: "modelo_invalido" });
  const generationConfig = { maxOutputTokens: maxTokens };
  if (suportaThinkingLevel(m)) generationConfig.thinkingConfig = { thinkingLevel: NIVEL[esforco] || "MEDIUM" };
  const body = { contents: paraContents(messages), generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  return {
    url: `${GEMINI_BASE}${encodeURIComponent(m)}:streamGenerateContent?alt=sse`,
    modelo: m,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    },
  };
}

const MOTIVOS_RECUSA = {
  SAFETY: "o filtro de segurança do Google bloqueou a resposta",
  PROHIBITED_CONTENT: "o Google classificou o conteúdo como proibido",
  BLOCKLIST: "o texto contém termos bloqueados pelo Google",
  SPII: "o texto parece conter dados pessoais sensíveis",
  RECITATION: "a resposta repetiria material protegido por direitos autorais",
  LANGUAGE: "o idioma não é suportado",
  OTHER: "o Google bloqueou a resposta sem informar o motivo",
};

export function traduzirErroGemini(httpStatus, erro = {}) {
  const status = erro.status || "";
  const msg = erro.message || "";
  if (/API key not valid|API_KEY_INVALID|key.*(invalid|expired)/i.test(msg) || httpStatus === 401 || status === "UNAUTHENTICATED")
    return "Chave do Gemini inválida ou expirada. Gere outra em aistudio.google.com/app/apikey e cole nas Opções.";
  if (/leaked/i.test(msg)) return "O Google bloqueou esta chave por ter sido exposta publicamente. Gere uma chave nova no AI Studio.";
  if (httpStatus === 403 || status === "PERMISSION_DENIED")
    return "A chave não tem permissão para usar a API Gemini (projeto restrito ou API desativada). Gere uma chave nova no AI Studio.";
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED")
    return (
      "Limite do plano gratuito do Gemini atingido. Se for o limite por minuto, espere cerca de 1 minuto e tente de novo. " +
      "O limite diário zera à meia-noite no horário do Pacífico (por volta das 4h–5h de Brasília). " +
      "Outra opção é trocar para o Gemini Flash-Lite nas Opções."
    );
  if (httpStatus === 404 || status === "NOT_FOUND")
    return "Modelo do Gemini não encontrado. Deixe o campo de modelo vazio nas Opções para usar o padrão.";
  if (status === "FAILED_PRECONDITION" || /location|region|country/i.test(msg))
    return "A API gratuita do Gemini não está disponível para esta conta ou região. Detalhe: " + (msg || status);
  if (httpStatus === 503 || status === "UNAVAILABLE") return "O Gemini está sobrecarregado no momento. Tente novamente em instantes.";
  if (httpStatus >= 500 || status === "INTERNAL") return "Erro temporário no servidor do Google. Tente novamente.";
  if (httpStatus === 400 || status === "INVALID_ARGUMENT") return "Requisição inválida para o Gemini: " + (msg || "verifique o modelo nas Opções.");
  return msg || `Erro desconhecido ao chamar o Gemini (HTTP ${httpStatus}).`;
}

// Junta as partes de todos os pedaços do stream. Partes de texto seguidas viram uma só;
// a thoughtSignature (se vier) é preservada para devolver no próximo turno.
export class AcumuladorGemini {
  constructor(modelo) {
    this.parts = [];
    this.finishReason = null;
    this.blockReason = null;
    this.usage = { input_tokens: 0, output_tokens: 0 };
    this.modelo = modelo;
  }

  aplicar(dados, { onTexto } = {}) {
    if (!dados || typeof dados !== "object") return;
    if (dados.error) {
      const e = dados.error;
      throw new ErroApi(traduzirErroGemini(e.code || 0, e), { status: e.code || 0, tipo: e.status || "", detalhe: e.message || "" });
    }
    if (dados.modelVersion) this.modelo = dados.modelVersion;
    if (dados.promptFeedback?.blockReason) this.blockReason = dados.promptFeedback.blockReason;
    const u = dados.usageMetadata;
    if (u) {
      this.usage.input_tokens = u.promptTokenCount || 0;
      this.usage.output_tokens = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    }
    const cand = dados.candidates?.[0];
    if (!cand) return;
    if (cand.finishReason) this.finishReason = cand.finishReason;
    for (const p of cand.content?.parts || []) {
      const ultima = this.parts.at(-1);
      const ehTexto = typeof p.text === "string" && !p.thought && Object.keys(p).every((k) => k === "text" || k === "thoughtSignature");
      if (ehTexto && ultima && ultima.__texto) {
        ultima.text += p.text;
        if (p.thoughtSignature) ultima.thoughtSignature = p.thoughtSignature;
      } else {
        const copia = JSON.parse(JSON.stringify(p));
        if (ehTexto) Object.defineProperty(copia, "__texto", { value: true, enumerable: false });
        this.parts.push(copia);
      }
      if (ehTexto && p.text && onTexto) onTexto(p.text);
    }
  }

  texto() {
    return this.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  }

  motivoRecusa() {
    if (this.blockReason) return MOTIVOS_RECUSA[this.blockReason] || `bloqueio (${this.blockReason})`;
    if (this.finishReason && MOTIVOS_RECUSA[this.finishReason]) return MOTIVOS_RECUSA[this.finishReason];
    return null;
  }
}

export async function enviarMensagemGemini(opcoes, { onTexto, signal, fetchFn = fetch } = {}) {
  const { url, init, modelo } = montarRequisicaoGemini(opcoes);
  let resp;
  try {
    resp = await fetchFn(url, { ...init, signal });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new ErroApi("Sem conexão com a API do Google Gemini. Verifique sua internet.", { tipo: "rede", detalhe: String(e) });
  }
  if (!resp.ok) {
    let erro = {};
    try {
      const j = await resp.json();
      erro = (Array.isArray(j) ? j[0] : j)?.error || {};
    } catch {
      /* corpo não-JSON */
    }
    throw new ErroApi(traduzirErroGemini(resp.status, erro), { status: resp.status, tipo: erro.status || "", detalhe: erro.message || "" });
  }
  const acc = new AcumuladorGemini(modelo);
  for await (const ev of lerSSE(resp.body)) acc.aplicar(ev.data, { onTexto });
  return acc;
}
