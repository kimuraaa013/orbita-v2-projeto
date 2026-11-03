# Órbita — Em breve

Página conceitual em português, React + Vite + Three.js, responsiva. A Órbita é uma futura base para portfólios e projetos, inspirada em missões espaciais. Marca fictícia para o TCC, sem vínculo com empresas reais. Não há formulário de cadastro nem promessa de lançamento em uma data fictícia.

## Registro de interesse

O site só envia um evento quando a pessoa clica em **Registrar interesse**. O botão usa `POST /api/visits` e a Lambda grava `eventType: "interest"` na tabela DynamoDB. O clique mostra o foguete em movimento durante o envio; após a resposta 204, mostra a confirmação e troca o botão por **Registrado**. Se a API falhar, o botão permite tentar novamente.

O navegador guarda em `localStorage` a confirmação e o `eventId` do interesse. Ao recarregar a página, o interesse continua confirmado e não há novo POST nesse navegador. Se houver falha de rede, a tentativa seguinte reutiliza o mesmo `eventId`; a escrita condicional da Lambda evita duplicação desse evento. Isso não identifica pessoas entre navegadores, dispositivos ou após limpar os dados locais. Abrir ou recarregar a página não envia evento.

**Ordem de publicação:** primeiro atualize o código da Lambda com `backend/lambda.mjs` e clique em **Deploy** no console; depois publique o conteúdo de `dist/` na raiz do S3 e invalide `/` e `/index.html` no CloudFront. O código antigo da Lambda aceita o POST, mas não grava `eventType`, fazendo um interesse parecer uma visita. Não é necessário criar outra rota, tabela ou permissão IAM.

## Versão 3 — código e leitura

- A página React foi separada em componentes por seção; textos e dados dos módulos ficam em uma lista simples.
- A requisição de interesse está em `src/analytics.js`, com funções pequenas para preparar os dados e enviar o POST somente no clique.
- A Lambda em `backend/lambda.mjs` usa o cliente de documentos do DynamoDB para gravar um objeto JavaScript comum; no editor da AWS, cole seu conteúdo em `index.mjs` e mantenha o handler `index.handler`.
- Textos menores foram ampliados, com cores e fundos mais opacos para facilitar a leitura sobre a animação.
- O rodapé mostra símbolos de LinkedIn, Instagram e X. São apenas visuais até a Órbita ter perfis oficiais; não apontam para contas inventadas.
- `orbita-v3-projeto.zip` contém o código para editar no VS Code. `orbita-v3-s3-sem-api.zip` contém os arquivos compilados para enviar à raiz do S3, com a chamada de visitas desativada por enquanto.

## Versão 2 — universo em movimento

- Planeta procedural, lua, estrelas e três satélites com painéis solares, renderizados em WebGL pelo Three.js.
- Mudança de enquadramento com a rolagem, paralaxe discreta do ponteiro e entrada progressiva das seções.
- Módulos de portfólio/projetos/descoberta interativos, história da marca e plano de lançamento.
- Botão para pausar a cena; preferência do sistema por movimento reduzido respeitada; composição CSS alternativa quando WebGL não está disponível.
- Three.js carregado em módulo separado; resolução limitada para reduzir carga gráfica; sem modelos ou texturas externos. As fontes continuam vindo do Google Fonts.
- Tudo continua estático: HTML/CSS/JS no S3; nenhuma renderização no servidor.

O registro de interesse está ativado em `public/config.json` (`analyticsEnabled: true`). Se editar esse arquivo, compile novamente; o `config.json` da raiz do pacote compilado também pode ser alterado diretamente antes de enviar ao S3. Invalide o cache de `/config.json` após atualizar. A falha da chamada à API não impede o site de abrir.

O botão de pausa interrompe o movimento automático e a paralaxe da cena 3D. Ao rolar, a composição estática ainda acompanha a seção. A preferência de movimento reduzido também desativa transições CSS.

## Executar e editar

Requer Node.js 22.12+ ou uma versão LTS compatível com Vite 7.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

O conteúdo fica em `src/main.jsx`; estilos em `src/style.css`. `dist/` contém somente arquivos estáticos prontos para publicar. React é incluído no JavaScript compilado: não é necessário Node no S3. As fontes vêm do Google Fonts, com alternativas locais se não carregarem; remova o @import para evitar essa requisição externa.

## Fluxo implementado

1. Navegador solicita a página ao CloudFront + WAF.
2. CloudFront entrega HTML/CSS/JS do S3 (ou de seu cache).
3. Somente após o clique em **Registrar interesse**, o navegador lê `/config.json` e faz **POST `/api/visits`** pelo mesmo domínio CloudFront.
4. O comportamento `/api/*` encaminha a chamada ao API Gateway → Lambda → DynamoDB.

É o clique no botão, tratado pelo JavaScript no navegador, que dispara a chamada. O S3 e o CloudFront não registram o interesse automaticamente. O UUID é criado no primeiro clique e reutilizado em tentativas após falha. O site abre mesmo com a API offline. Bloqueadores, JavaScript desabilitado e falhas de rede podem impedir o registro. Não é uma medição exata de pessoas únicas.

## Configuração AWS

Não há recursos AWS criados ou credenciais incluídas neste projeto. A Lambda é um exemplo de integração pronto para configurar e validar em sua conta.

### S3 e CloudFront

- Bucket privado, Block Public Access habilitado. Use origem REST do S3, não o endpoint de website.
- Configure Origin Access Control (OAC) e bucket policy permitindo leitura apenas à distribuição.
- Faça upload **do conteúdo de dist/** para a raiz do bucket. Defina `index.html` como Default Root Object.
- Comportamento padrão: origem S3, HTTPS, métodos GET/HEAD, cache dos arquivos estáticos.
- `assets/*`: cache longo (`public,max-age=31536000,immutable`), pois os nomes possuem hash.
- `index.html` e `config.json`: `no-cache` e comportamento/política sem TTL mínimo positivo; invalide `/index.html`, `/` e `/config.json` quando necessário.
- Esta página usa âncoras, não rotas SPA: não precisa transformar 403/404 globais em index.html. Isso mascararia erros da API.
- Associe seu Web ACL WAF à distribuição.

### API Gateway

- Crie uma HTTP API regional com stage `$default` e rota **POST /api/visits**.
- Configure integração Lambda proxy, payload 2.0, com permissão para o API Gateway invocar a função.
- Na distribuição CloudFront, adicione uma origem HTTPS com o domínio `ID.execute-api.REGIAO.amazonaws.com`, sem caminho no campo de domínio, e Origin Path vazio para `$default`.
- Crie comportamento **/api/*** apontando a essa origem, com precedência sobre o padrão. Habilite os métodos que incluem POST (no CloudFront, opção de todos os métodos), cache policy **CachingDisabled**.
- Use origin request policy personalizada que encaminhe `Content-Type`, `CloudFront-Viewer-Country`, `CloudFront-Viewer-Country-Region`, sem cookies e sem query strings. Não encaminhe o Host do visitante. Alternativa mais abrangente: **AllViewerExceptHostHeader**.
- O código local da Lambda já verifica `X-Origin-Verify`. Para ativá-lo na AWS, configure o mesmo segredo na origem do API Gateway no CloudFront e na variável `ORIGIN_VERIFY_SECRET` da Lambda, depois implante o código atualizado. O WAF associado somente ao CloudFront não inspeciona chamadas diretas ao endereço `execute-api`.
- CloudFront mantém o prefixo `/api`: a rota precisa ser `/api/visits`, não somente `/visits`. Para stage nomeado, configure Origin Path `/nome-do-stage` e adapte a validação de rawPath conforme o evento real.
- Como site e API compartilham origem, CORS não é necessário. Se usar URL direta em `public/config.json`, configure CORS na API para o domínio exato do site e adapte a proteção de origem; a configuração padrão foi projetada para CloudFront.

### Lambda e DynamoDB

- Tabela DynamoDB com partition key **eventId** (String), sem sort key, capacidade on-demand. Ative TTL no atributo **expiresAt** (30 dias no exemplo; expiração é assíncrona).
- Empacote `backend/lambda.mjs` e suas dependências (`npm install` dentro de backend); use runtime Node.js compatível, handler `lambda.handler`.
- Variáveis necessárias para o código local atualizado: `VISITS_TABLE` = nome da tabela; `ORIGIN_VERIFY_SECRET` = segredo hexadecimal de 64 caracteres, igual ao cabeçalho `X-Origin-Verify` configurado na origem do API Gateway no CloudFront. Sem o segredo correspondente, a Lambda retorna `403` e não grava.
- Role da Lambda: `dynamodb:PutItem` apenas na tabela e permissões mínimas de logs. Nunca disponibilize credenciais AWS no navegador.
- Registro: eventId, eventType, visitedAt (horário UTC do servidor), visitedAtLocal (data/hora legível no fuso do visitante), timeZone, source (domínio de referência), country, region e expiresAt. Não grava IP, user-agent, URL completa ou identificador de pessoa. O navegador guarda o eventId do interesse em localStorage. Não faça log do evento bruto.
- `visitedAt` continua em ISO 8601/UTC para comparação e ordenação. `visitedAtLocal` usa o formato regional sugerido pelo código de país e o cabeçalho `CloudFront-Viewer-Time-Zone`. Sem fuso válido, usa UTC. Itens já gravados não ganham os novos atributos automaticamente.
- País/região vêm dos cabeçalhos do CloudFront, são aproximados e podem estar ausentes. O domínio de referência é entrada não confiável e pode faltar; não o use para autorização.
- Escrita condicional evita duplicar o mesmo eventId. Recarregar a página não envia novo evento; limpar o armazenamento local permite registrar outro interesse.
- Os logs dos serviços AWS têm configurações próprias e podem conter IP. A ausência de IP nesta tabela não garante anonimização nem conformidade legal da implantação inteira.

## Verificar na AWS

Abra pelo domínio CloudFront e inspecione Network: antes do clique, não deve existir `POST /api/visits`. Clique em **Registrar interesse**: o POST deve retornar 204 e criar um item com `eventType: "interest"`. Recarregue: o botão deve continuar **Registrado** e nenhum novo POST deve ocorrer. Clique nas perspectivas: não deve surgir outro evento. Bloqueie a API antes de confirmar: a página deve continuar utilizável e o botão deve permitir nova tentativa. Repita o mesmo eventId: apenas um item deve existir. Confira a visualização em celular.

O teste local valida payload, minimização de dados e falha HTTP. A integração real AWS depende da infraestrutura acima e não foi executada neste ambiente.

## Referências oficiais

- https://vite.dev/guide/static-deploy
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html
- https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/adding-cloudfront-headers.html
