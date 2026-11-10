// Service worker: menu de contexto, atalhos e abertura do painel lateral.
import { detectarPerguntaNaPagina } from "./lib/detectar.js";

const PAINEL = "sidepanel/panel.html";
const temSidePanel = () => typeof chrome.sidePanel?.open === "function";

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "explicar", title: "Explicar com IA", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "dica", title: "Só uma dica (sem resposta)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "abrir", title: "Abrir o Tutor IA", contexts: ["page"] });
  });
  configurarAcao();
  if (reason === "install") {
    const { apiKey, geminiKey } = await chrome.storage.local.get(["apiKey", "geminiKey"]);
    if (!apiKey && !geminiKey) chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(configurarAcao);

function configurarAcao() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

// Navegadores sem a API sidePanel: o clique no ícone abre o painel numa janela.
chrome.action.onClicked.addListener((tab) => abrirPainel(tab));

// IMPORTANTE: sidePanel.open() precisa ser chamado imediatamente no gesto do
// usuário (antes de qualquer await), senão o navegador recusa.
function abrirPainel(tab) {
  if (temSidePanel() && tab?.id != null) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => abrirJanela());
  } else {
    abrirJanela();
  }
}

async function abrirJanela() {
  const { janelaPainel } = await chrome.storage.session.get("janelaPainel");
  if (janelaPainel != null) {
    try {
      await chrome.windows.update(janelaPainel, { focused: true });
      return;
    } catch {
      /* a janela foi fechada */
    }
  }
  const w = await chrome.windows.create({ url: chrome.runtime.getURL(PAINEL), type: "popup", width: 460, height: 760 });
  await chrome.storage.session.set({ janelaPainel: w.id });
}

async function enviarParaPainel({ texto, modo, tab }) {
  await chrome.storage.session.set({
    perguntaPendente: {
      texto,
      modo,
      pagina: { titulo: tab?.title || "", url: tab?.url || "" },
      ts: Date.now(),
    },
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  abrirPainel(tab);
  if (info.menuItemId === "abrir") return;
  const modo = info.menuItemId === "dica" ? "dica" : "completo";
  // selectionText vem sem quebras de linha; tentamos ler a seleção completa.
  lerSelecao(tab)
    .then((t) => enviarParaPainel({ texto: t || info.selectionText || "", modo, tab }))
    .catch(() => enviarParaPainel({ texto: info.selectionText || "", modo, tab }));
});

chrome.commands.onCommand.addListener((comando, tab) => {
  abrirPainel(tab);
  const modo = comando === "dica-selecao" ? "dica" : "completo";
  lerSelecao(tab)
    .then((t) => t && enviarParaPainel({ texto: t, modo, tab }))
    .catch(() => {});
});

async function lerSelecao(tab) {
  if (!tab?.id) return "";
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => String(window.getSelection ? window.getSelection() : ""),
    });
    return (res?.result || "").trim();
  } catch (e) {
    const r = await lerDaPaginaDeTeste(tab.id);
    if (r) return r.origem === "selecao" ? r.texto : "";
    throw e;
  }
}

// Páginas da própria extensão (test.html) não aceitam executeScript; elas respondem
// por mensagem. Em qualquer outra aba não há quem responda e o resultado é null.
async function lerDaPaginaDeTeste(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { tipo: "detectar-pagina-teste" });
    return r && typeof r.texto === "string" ? r : null;
  } catch {
    return null;
  }
}

// O painel pede a leitura da pergunta da aba ativa (botão "Detectar pergunta").
chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
  if (msg?.tipo !== "detectar") return;
  (async () => {
    try {
      const janela = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      const [tab] = await chrome.tabs.query({ active: true, windowId: janela.id });
      if (!tab?.id) throw new Error("Nenhuma aba encontrada.");
      let resultado;
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: detectarPerguntaNaPagina });
        resultado = res.result;
      } catch (e) {
        resultado = await lerDaPaginaDeTeste(tab.id);
        if (!resultado) throw e;
      }
      responder({ ok: true, ...resultado });
    } catch (e) {
      responder({ ok: false, erro: traduzirErroLeitura(e) });
    }
  })();
  return true; // resposta assíncrona
});

function traduzirErroLeitura(e) {
  const m = String(e?.message || e);
  if (/Cannot access|cannot be scripted|permission|activeTab|Missing host/i.test(m)) {
    return (
      "Sem permissão para ler esta aba. Clique no ícone do Tutor IA com a aba da questão aberta, " +
      "ou use o botão direito sobre o texto selecionado → \"Explicar com IA\". " +
      "Também dá para liberar a leitura nas Opções. (Páginas internas do navegador nunca podem ser lidas.)"
    );
  }
  return m;
}
