// Camada única que o painel e as opções usam, independente do provedor de IA.
//
// Histórico neutro (estado.messages):
//   { role: "user", content: "texto" }
//   { role: "assistant", provedor: "anthropic"|"gemini", content: <conteúdo nativo>, texto: "texto visível" }
// Cada adaptador devolve o conteúdo nativo intacto ao seu próprio provedor e usa só o
// texto quando o turno veio de outro provedor (ex.: trocou de Claude para Gemini no meio).

import { enviarMensagem as enviarAnthropic, MODELO_PADRAO } from "./anthropic.js";
import { enviarMensagemGemini, MODELO_PADRAO_GEMINI } from "./gemini.js";

export const PROVEDORES = {
  gemini: { nome: "Google Gemini", chave: "geminiKey", campoModelo: "modeloGemini", padrao: MODELO_PADRAO_GEMINI },
  anthropic: { nome: "Anthropic Claude", chave: "apiKey", campoModelo: "modelo", padrao: MODELO_PADRAO },
};
export const PROVEDOR_PADRAO = "gemini";

export function provedorDe(config) {
  return PROVEDORES[config?.provedor] ? config.provedor : PROVEDOR_PADRAO;
}

export function chaveDe(config) {
  return (config?.[PROVEDORES[provedorDe(config)].chave] || "").trim();
}

export function modeloDe(config) {
  const p = PROVEDORES[provedorDe(config)];
  return (config?.[p.campoModelo] || "").trim() || p.padrao;
}

// Formato exigido pela API da Anthropic: só role + content.
export function paraMensagensAnthropic(messages) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    // Turnos antigos sem "provedor" foram gerados pelo Claude (versão 1.0 da extensão).
    if ((m.provedor ?? "anthropic") === "anthropic") return { role: "assistant", content: m.content };
    return { role: "assistant", content: [{ type: "text", text: m.texto || "" }] };
  });
}

/**
 * Envia a conversa ao provedor configurado.
 * Retorna { texto, fim: "ok"|"limite"|"recusa", motivo, uso: {entrada, saida}, turno, modelo }.
 * "turno" é a mensagem de assistant (formato neutro) a guardar no histórico.
 */
export async function enviarConversa({ config, system, messages, esforco, maxTokens }, { onTexto, signal, fetchFn } = {}) {
  const provedor = provedorDe(config);
  const comuns = { apiKey: chaveDe(config), modelo: modeloDe(config), esforco: esforco || config.esforco, system, maxTokens };
  const extras = { onTexto, signal, ...(fetchFn ? { fetchFn } : {}) };

  if (provedor === "gemini") {
    const r = await enviarMensagemGemini({ ...comuns, messages }, extras);
    const texto = r.texto();
    const motivo = r.motivoRecusa();
    return {
      texto,
      fim: motivo ? "recusa" : r.finishReason === "MAX_TOKENS" ? "limite" : "ok",
      motivo,
      uso: { entrada: r.usage.input_tokens, saida: r.usage.output_tokens },
      modelo: r.modelo,
      turno: { role: "assistant", provedor, content: r.parts, texto },
    };
  }

  const r = await enviarAnthropic({ ...comuns, messages: paraMensagensAnthropic(messages) }, extras);
  const texto = r.texto();
  return {
    texto,
    fim: r.stopReason === "refusal" ? "recusa" : r.stopReason === "max_tokens" ? "limite" : "ok",
    motivo: r.stopReason === "refusal" ? "o filtro de segurança do Claude recusou a solicitação" : null,
    uso: { entrada: r.usage.input_tokens || 0, saida: r.usage.output_tokens || 0 },
    modelo: r.modelo,
    turno: { role: "assistant", provedor, content: r.conteudoParaHistorico(), texto },
  };
}
