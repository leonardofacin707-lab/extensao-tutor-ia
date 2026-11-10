import { MODELO_PADRAO, ESFORCO_PADRAO } from "./anthropic.js";

// As chaves ficam em chrome.storage.local (só neste navegador, nunca sincronizadas).
// "apiKey" é a chave da Anthropic (nome mantido da versão 1.0 para não perder a configuração).
export const PADROES = {
  provedor: "gemini", // "gemini" ou "anthropic"
  geminiKey: "",
  modeloGemini: "", // vazio = modelo padrão do Gemini
  apiKey: "",
  modelo: MODELO_PADRAO,
  esforco: ESFORCO_PADRAO,
  modoPadrao: "dica", // "dica" ou "completo"
  perfil: "",
};

export async function carregarConfig() {
  const dados = await chrome.storage.local.get(Object.keys(PADROES));
  return { ...PADROES, ...dados };
}

export async function salvarConfig(parcial) {
  await chrome.storage.local.set(parcial);
}
