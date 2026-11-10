// Instruções do tutor. O foco é ENSINAR: o estudante decide e responde sozinho.

export function promptDoSistema({ perfil = "" } = {}) {
  const sobre = perfil.trim()
    ? `\nSobre o estudante (informado por ele): ${perfil.trim()}\nAdapte exemplos e vocabulário a esse perfil.`
    : "";
  return `Você é um tutor de estudos paciente e didático, falando em português do Brasil.
O estudante usa você dentro de uma extensão de navegador para ENTENDER perguntas de exercícios, questionários e materiais de estudo. Ele sempre responde sozinho na plataforma; você nunca responde por ele em lugar nenhum, apenas explica.${sobre}

Como ensinar:
- Explique o conceito por trás da pergunta antes de chegar a qualquer conclusão.
- Mostre o raciocínio passo a passo, de forma que o estudante consiga refazê-lo sozinho numa questão parecida.
- Quando houver alternativas, analise CADA uma: por que está certa ou por que está errada, apontando o erro conceitual típico que leva alguém a escolhê-la.
- Se a pergunta estiver incompleta, ambígua ou depender de algo que não veio no texto (imagem, tabela, código, enunciado anterior), diga isso claramente e explique o que faltou, em vez de adivinhar.
- Se houver mais de uma interpretação razoável, mostre as interpretações.
- Se você não tiver certeza de algo, diga que não tem certeza. Não invente fontes nem dados.
- Use exemplos curtos e concretos. Em perguntas de programação, use trechos de código pequenos.
- Seja direto: sem introduções longas nem elogios.

Formatação: use Markdown simples (títulos com ##, listas, **negrito**, \`código\` e blocos de código). Não use tabelas nem HTML.`;
}

const ESTRUTURA_COMPLETA = `Explique esta pergunta seguindo esta estrutura:

## O que a pergunta pede
(1 a 3 frases, com suas palavras)

## Conceito-chave
(o conhecimento necessário para responder, explicado de forma clara)

## Raciocínio passo a passo
(passos numerados até a conclusão)

## Análise das alternativas
(se houver alternativas: uma por uma, dizendo se está certa ou errada e POR QUÊ. Se não houver alternativas, explique como seria uma boa resposta e quais erros evitar.)

## Para fixar
(2 ou 3 tópicos curtos com o que levar desta questão para as próximas)`;

export function mensagemInicial({ pergunta, modo, pagina }) {
  const origem = pagina?.titulo || pagina?.url ? `\n\n(Origem: ${[pagina.titulo, pagina.url].filter(Boolean).join(" — ")})` : "";
  const bloco = `<pergunta>\n${pergunta.trim()}\n</pergunta>${origem}`;
  if (modo === "dica") {
    return `${bloco}

Quero tentar resolver sozinho. Me dê só a DICA 1: aponte o conceito ou o caminho a seguir em 2 a 4 frases e termine com uma pergunta que me guie.
NÃO revele a resposta, NÃO diga qual alternativa é a correta e NÃO elimine alternativas ainda.`;
  }
  return `${bloco}\n\n${ESTRUTURA_COMPLETA}`;
}

export function mensagemMaisDica(nivel) {
  return `Ainda não consegui. Me dê a DICA ${nivel}: um pouco mais específica que a anterior (pode, por exemplo, mostrar o primeiro passo do raciocínio ou um exemplo análogo), em até 5 frases, terminando com uma pergunta que me guie.
Continue SEM revelar a resposta final e sem dizer qual alternativa é a correta.`;
}

export function mensagemRevelar() {
  return `Agora pode me mostrar a explicação completa.\n\n${ESTRUTURA_COMPLETA}`;
}

export function mensagemAvaliarRaciocinio(tentativa) {
  return `Esta é a minha tentativa de resposta e o meu raciocínio:

<minha_tentativa>
${tentativa.trim()}
</minha_tentativa>

Avalie meu raciocínio como um professor: o que está correto, onde há erro ou lacuna e por quê. Se eu errei, explique o conceito que me confundiu e me mostre como corrigir o raciocínio. Se eu acertei, confirme e mostre se há algo que eu poderia justificar melhor.`;
}
