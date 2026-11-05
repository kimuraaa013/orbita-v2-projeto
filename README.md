# Órbita — site em breve e arquitetura serverless na AWS

A **Órbita** é uma marca fictícia criada para um TCC: uma futura base para apresentar portfólios, projetos e processos criativos. A página de lançamento usa React, Vite e Three.js para construir um universo com planeta, órbitas e satélites. O site é entregue como arquivos estáticos; a parte dinâmica registra o interesse de quem clica no botão **Registrar interesse**. Não há cadastro de pessoas nem data de lançamento anunciada.

Este README documenta a implantação inicial feita **manualmente pelo Console de Gerenciamento da AWS**, serviço por serviço, e a publicação posterior do código pelo GitHub Actions. A infraestrutura foi configurada no console, sem Terraform ou CloudFormation. As telas da AWS podem mudar de nome ou posição.

## Sumário

- [Arquitetura atual](#arquitetura-atual)
- [Por que foram escolhidos serviços gerenciados](#por-que-foram-escolhidos-serviços-gerenciados)
- [Passo a passo da implantação pelo Console AWS](#passo-a-passo-da-implantação-pelo-console-aws)
- [Passo adicional: publicação automática pelo GitHub Actions](#passo-adicional-publicação-automática-pelo-github-actions)
- [Por que o cabeçalho personalizado e a variável da Lambda](#por-que-o-cabeçalho-personalizado-e-a-variável-da-lambda)
- [O que o frontend e a Lambda registram](#o-que-o-frontend-e-a-lambda-registram)
- [Testes de segurança feitos até aqui](#testes-de-segurança-feitos-até-aqui)
- [Executar, atualizar e verificar](#executar-atualizar-e-verificar)
- [Arquivos principais](#arquivos-principais)
- [Referências oficiais](#referências-oficiais)

## Arquitetura atual

```mermaid
flowchart LR
    navegador["Navegador<br/>site Órbita"] -->|"GET e POST no mesmo domínio"| waf["AWS WAF<br/>CloudFront global · us-east-1"]
    terminal["Terminal"] -->|"URL do CloudFront"| waf
    waf --> cloudfront["CloudFront<br/>HTTPS e comportamentos"]
    cloudfront -->|"Comportamento padrão · OAC"| s3["S3 privado<br/>HTML, CSS, JS · us-east-2"]
    cloudfront -->|"/api/* · POST<br/>X-Origin-Verify"| api["API Gateway HTTP API<br/>POST /api/visits · us-east-2"]
    api --> lambda["Lambda<br/>Valida requisição · us-east-2"]
    lambda --> segredo{"Segredo confere?"}
    segredo -->|"Sim"| dynamo["DynamoDB<br/>Grava interesse · us-east-2"]
    segredo -->|"Não"| negado["HTTP 403<br/>Não grava"]
    waf -.->|"Logs do WAF"| logsWaf["CloudWatch Logs<br/>us-east-1"]
    lambda -.->|"Logs da função"| logsLambda["CloudWatch Logs<br/>us-east-2"]
    terminal -.->|"execute-api direto<br/>sem CORS"| api
    navegador -.->|"execute-api direto"| cors{"Preflight CORS<br/>permite?"}
    cors -->|"Não"| semPost["Navegador não envia POST"]
    cors -.->|"Sim, sem o segredo"| api

    classDef principal fill:#073b66,stroke:#539ad1,color:#fff
    classDef decisao fill:#092a45,stroke:#539ad1,color:#fff
    classDef resultado fill:#123248,stroke:#539ad1,color:#fff
    class navegador,terminal,waf,cloudfront,s3,api,lambda,dynamo,logsWaf,logsLambda principal
    class segredo,cors decisao
    class negado,semPost resultado
```

[Abrir o diagrama SVG detalhado em tamanho completo](docs/arquitetura-orbita.svg).

**Entrega do site.** O navegador solicita `https://<COLE_DOMINIO_CLOUDFRONT_AQUI>/`. O AWS WAF associado à distribuição inspeciona a solicitação. O CloudFront entrega o conteúdo que está em cache ou busca `index.html`, CSS, JavaScript, imagens e `config.json` no bucket privado do S3. O Origin Access Control (OAC) autoriza o CloudFront a ler os objetos sem tornar o bucket público. O certificado TLS do domínio `cloudfront.net` protege a conexão HTTPS com o visitante.

**Registro do interesse.** Ao clicar no botão, o JavaScript faz `POST /api/visits` no **mesmo domínio do site**. O comportamento `/api/*` do CloudFront escolhe a origem do API Gateway, acrescenta o cabeçalho personalizado `X-Origin-Verify` à requisição enviada à origem e não armazena a resposta em cache. O API Gateway HTTP API invoca a Lambda; ela valida o cabeçalho e o corpo e grava o item no DynamoDB. O sucesso retorna HTTP `204`, sem corpo. Abrir ou recarregar a página não registra interesse.

**Observabilidade.** A ACL do WAF envia seus registros de tráfego para um grupo do CloudWatch Logs. A Lambda também pode escrever seus logs de execução no CloudWatch Logs por meio das permissões básicas do seu perfil IAM. São fluxos de log diferentes. As métricas e amostras do WAF ajudam a ver regras acionadas; os logs completos permitem examinar uma solicitação com mais detalhe a partir do momento em que o registro foi habilitado.

| Componente | Papel nesta implantação | Região/escopo |
| --- | --- | --- |
| S3 privado | Armazenar os arquivos compilados do site em bucket privado | Ohio, `us-east-2` |
| CloudFront | Entregar o site por HTTPS e encaminhar `/api/*` para a API | Global |
| AWS WAF `orbita-cloudfront-waf` | Inspecionar requisições que passam pelo CloudFront | Global para CloudFront, administrado em `us-east-1` |
| API Gateway HTTP API | Expor a rota `POST /api/visits` e invocar a Lambda | Ohio, `us-east-2` |
| Lambda `orbita-registrar-visita` | Validar a requisição e registrar o interesse | Ohio, `us-east-2` |
| DynamoDB `orbita-visits` | Guardar um item por `eventId` | Ohio, `us-east-2` |
| CloudWatch Logs | Receber os logs da ACL do WAF e, separadamente, da Lambda | Grupo do WAF em `us-east-1`; grupo da Lambda em `us-east-2` |

O domínio do CloudFront é fornecido pela AWS, por isso esta implantação não depende de Route 53 nem de domínio próprio. O **S3 usa a origem normal do bucket com OAC**: o endpoint de hospedagem de site estático do S3, mesmo que tenha sido ativado durante a configuração inicial, não é a origem usada para servir esta distribuição privada.

### Por que o WAF e os logs dele estão em `us-east-1`?

O CloudFront é um serviço **global**: o conteúdo é entregue por pontos de presença, e o usuário não escolhe Ohio como a região da distribuição. Para associar uma Web ACL do AWS WAF a uma distribuição CloudFront, a AWS exige o escopo **CloudFront (global)** e fixa a região de gerenciamento dessa ACL em **Norte da Virgínia (`us-east-1`)**. Isso é uma exigência da integração WAF–CloudFront, não uma decisão de mover o site para lá. Uma ACL **regional** em Ohio não seria a mesma proteção associada a essa distribuição. Veja a [documentação da AWS sobre a criação da Web ACL](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-creating.html).

O **CloudWatch não está inteiro em `us-east-1`**. Ele é regional. Para receber os registros dessa Web ACL global, o grupo de **CloudWatch Logs do WAF** precisa estar na **mesma região da ACL**, portanto em `us-east-1`. Já a **Lambda está em Ohio (`us-east-2`)**; seu grupo separado de logs de execução fica em Ohio. Por isso, ao consultar os registros do WAF no Console AWS, selecione **Norte da Virgínia**; para os logs da função, selecione **Ohio**. A tabela DynamoDB, a HTTP API e o bucket S3 continuam em Ohio. Veja a [exigência de região para o destino de logs do WAF](https://docs.aws.amazon.com/waf/latest/developerguide/logging-cw-logs.html).

O diagrama também mostra dois caminhos alternativos de teste: um `fetch` do navegador diretamente para `execute-api` pode provocar uma verificação CORS antes do POST; se essa verificação falhar, o navegador não envia o POST. O terminal não aplica CORS e pode chamar tanto o domínio do CloudFront quanto o `execute-api`. No acesso direto à API sem o valor esperado no cabeçalho, o API Gateway ainda invoca a Lambda, que responde `403` antes de gravar no DynamoDB.

## Por que foram escolhidos serviços gerenciados

O objetivo do TCC é demonstrar entrega de conteúdo, integração entre frontend e backend e controles de segurança sem manter um servidor ligado continuamente. Nesta solução, a AWS opera a infraestrutura subjacente de armazenamento, CDN, entrada HTTP, execução, banco e inspeção de requisições. O projeto ainda precisa configurar permissões, regras, logs, orçamento, código e atualizações.

| Necessidade | Serviço escolhido | O que seria necessário em servidores próprios ou EC2 |
| --- | --- | --- |
| Hospedar o frontend compilado | S3 privado | Manter servidor web, disco, sistema operacional e rotina de atualização. |
| Entregar arquivos com HTTPS e cache | CloudFront | Configurar proxy/CDN, certificados, cache e distribuição geográfica. |
| Receber a chamada HTTP | API Gateway HTTP API | Operar Nginx ou outro proxy, disponibilidade e roteamento da API. |
| Executar a lógica somente sob demanda | Lambda | Manter processo Node.js, máquinas, escalabilidade e deploy do serviço. |
| Persistir os eventos | DynamoDB sob demanda | Instalar e operar banco, backups, capacidade e atualizações. |
| Inspecionar e observar tráfego | AWS WAF e CloudWatch Logs | Operar regras, coleta e armazenamento de logs por conta própria. |

O frontend React **continua compilado** mesmo usando uma API dinâmica. O navegador recebe HTML, CSS e JavaScript do S3 via CloudFront; a chamada à API acontece depois, no clique. A Lambda não recompila React a cada acesso. Essa escolha reduz a manutenção operacional para uma demonstração pequena, mas não significa custo zero: WAF, CloudWatch Logs e os demais serviços podem consumir créditos e gerar cobrança conforme uso e configuração.

## Passo a passo da implantação pelo Console AWS

Os passos abaixo descrevem o que foi montado e como reproduzir a mesma arquitetura no **Console AWS**. Os nomes das opções podem aparecer em português ou inglês. Não inclua o valor do segredo, chaves de acesso nem dados da conta neste repositório.

### 1. Compilar o frontend no computador

Na pasta do projeto, com Node.js compatível com o Vite 7:

```sh
npm ci
npm run build
```

O Vite cria `dist/`. Essa pasta é o resultado pronto para hospedagem: envie **o conteúdo de `dist/`**, incluindo `index.html`, `assets/`, `config.json` e `favicon.svg`, para a **raiz** do bucket. Não envie `src/`, `node_modules/` nem o arquivo ZIP para servir o site. Os nomes dos arquivos em `assets/` podem mudar a cada compilação.

### 2. Criar e preencher o bucket S3

No **Console AWS → S3 → Criar bucket**, foi criado um bucket de propósito geral em Ohio (`us-east-2`). O acesso público foi bloqueado. Depois, em **Objetos → Carregar**, os arquivos compilados foram enviados. A política de leitura do bucket foi limitada à distribuição CloudFront com OAC, em vez de tornar os objetos públicos. Para este fluxo, a criptografia SSE-S3 padrão atende ao armazenamento dos arquivos; versionamento pode ajudar a recuperar uma publicação anterior, mas versões antigas também ocupam espaço.

### 3. Criar a distribuição CloudFront para o site

No **Console AWS → CloudFront → Criar distribuição**, foi selecionado o domínio regional normal do bucket S3 como origem, com acesso privado por **Origin Access Control**. A opção do console que permite ao CloudFront atualizar a política do bucket foi usada para autorizar a leitura pela distribuição. O **Default root object / Objeto raiz padrão** foi definido como `index.html`. O comportamento padrão aponta para o S3; o visitante usa HTTPS no domínio `cloudfront.net` fornecido pela AWS. Não foi necessário comprar domínio ou emitir um certificado ACM próprio para esse endereço.

Uma *origin* é o destino de onde o CloudFront busca conteúdo; um *behavior* é a regra que escolhe a origem e define métodos HTTP, cache e políticas para um padrão de caminho. Neste caso, o comportamento padrão atende o site no S3, e `/api/*` atende a API.

### 4. Criar a tabela DynamoDB

No **Console AWS → DynamoDB → Criar tabela**, foi criada `orbita-visits` com chave de partição `eventId` do tipo **String**, sem chave de classificação, e capacidade **sob demanda**. A Lambda calcula `expiresAt` como um horário Unix aproximadamente 30 dias após o registro. **Esse atributo sozinho não apaga itens**: se a exclusão automática for desejada, é necessário habilitar o TTL da tabela usando exatamente o atributo `expiresAt`. A remoção pelo TTL é assíncrona.

### 5. Criar a função Lambda e sua permissão

No **Console AWS → Lambda → Criar função**, foi criada `orbita-registrar-visita` com runtime Node.js. O código de referência está em [`backend/lambda.mjs`](backend/lambda.mjs). Ao colá-lo no editor `index.mjs` da função no console, o handler permanece `index.handler`. Os runtimes Node.js atuais da Lambda incluem uma versão do AWS SDK para JavaScript v3, utilizada pelo editor do console. Para controlar a versão das dependências em um pacote próprio, a pasta `backend/` contém o manifesto para instalá-las e incluí-las no envio.

No perfil de execução IAM da Lambda, além das permissões básicas para logs, foi adicionada uma política de menor privilégio que permite `dynamodb:PutItem` **somente** na tabela `orbita-visits`. Em **Configuração → Variáveis de ambiente**, foram definidos `VISITS_TABLE` com o nome da tabela e `ORIGIN_VERIFY_SECRET` com o valor privado acordado com a origem do CloudFront. O valor do segredo **não** fica no React, no `config.json`, no README ou no Git. Depois de alterar o código ou as variáveis, é preciso implantar a função no console.

### 6. Criar a HTTP API no API Gateway

No **Console AWS → API Gateway**, foi criada uma **HTTP API regional** com a rota `POST /api/visits`, integração com a Lambda e formato de evento da integração Lambda proxy 2.0. O estágio `$default` está com implantação automática. O endereço regional `execute-api` continua existindo; o CloudFront não o torna privado. A permissão para o API Gateway invocar a Lambda deve estar presente na política de recurso da função, geralmente criada durante a integração pelo console.

### 7. Associar a API ao CloudFront

Em **CloudFront → distribuição → Origins / Origens**, foi adicionada uma segunda origem com o **nome de domínio** da HTTP API, sem `https://` e sem caminho. A ligação com a origem usa HTTPS. Nessa origem, foi configurado o cabeçalho personalizado `X-Origin-Verify`, cujo valor privado é o mesmo configurado em `ORIGIN_VERIFY_SECRET` na Lambda. O campo *Origin path* fica vazio para o estágio `$default`.

Em **Behaviors / Comportamentos**, foi criado o padrão `/api/*`, apontando para a origem do API Gateway. Os métodos permitidos incluem `POST`; a política de cache é `CachingDisabled`, e a política de encaminhamento de origem usada é `AllViewerExceptHostHeader`. O cabeçalho `Host` do domínio CloudFront não deve substituir o host esperado pela API. Essa política também inclui cabeçalhos de localização gerados pelo CloudFront; a Lambda aproveita `CloudFront-Viewer-Country`, `CloudFront-Viewer-Country-Region` e `CloudFront-Viewer-Time-Zone` quando chegam. Se algum valor faltar, o código usa `unknown` ou `UTC`.

O frontend usa `/api/visits`, e não a URL `execute-api`, porque o navegador já está no domínio do CloudFront. Isso mantém a chamada na mesma origem do site e evita a necessidade de CORS para esse fluxo. CORS controla o acesso a respostas entre origens **no navegador**; não impede `curl` ou outro cliente de chamar uma URL. A proteção contra gravação direta está na validação feita pela Lambda.

### 8. Associar o WAF ao CloudFront

No **Console AWS → WAF e Shield / CloudFront → Security**, foi criado o pacote de proteção (Web ACL) `orbita-cloudfront-waf`, com escopo **CloudFront (global)**, e associada a distribuição. O grupo gerenciado **AWS Managed Rules — Core rule set** foi adicionado. Para observar o comportamento antes de bloquear tráfego legítimo, as regras começaram em **Count / Contar**. Depois do teste, a ação de `CrossSiteScripting_QUERYARGUMENTS` foi alterada para **Block / Bloquear**. As demais regras devem ser conferidas individualmente antes de mudar de Count para Block.

Essa ACL fica **na entrada do CloudFront**, antes da escolha da origem. Portanto, inspeciona tanto pedidos do site no S3 quanto pedidos `/api/*` que passem pela distribuição. Ela **não inspeciona** chamadas feitas diretamente ao endereço `execute-api` da HTTP API.

### 9. Habilitar os logs do WAF no CloudWatch

No **WAF → `orbita-cloudfront-waf` → Configurar registro e solicitações em amostra**, foi habilitado **Registro em log → Destino do registro em log → Amazon CloudWatch Logs**. O grupo de logs do WAF usa o prefixo obrigatório `aws-waf-logs-`. Como a ACL protege CloudFront, seu escopo global é administrado em **Norte da Virgínia (`us-east-1`)**; é nessa região que se consulta o grupo de logs do WAF, mesmo com S3, API, Lambda e DynamoDB em Ohio (`us-east-2`). No CloudWatch, abra **Logs → Gerenciamento de logs → Grupos de logs**, selecione `us-east-1` e procure o grupo `aws-waf-logs-*` escolhido no console.

As **solicitações em amostra** e as métricas já eram úteis sem o registro completo, mas mostram apenas uma parte do tráfego e não necessariamente todos os campos de uma ocorrência. Os logs completos começam a ser enviados **a partir da habilitação**; não recuperam solicitações passadas. Inspeção de logs e consultas podem gerar custo, então acompanhe o painel de faturamento e a retenção do grupo. Também considere censurar campos sensíveis se vierem a ser usados no site.

## Passo adicional: publicação automática pelo GitHub Actions

Depois da montagem manual, foram criados dois *workflows* de **implantação contínua (CD)**. Eles publicam novas versões do código: o primeiro compila o React/Vite, envia `dist/` ao S3 e solicita a invalidação do cache do CloudFront; o segundo empacota `backend/lambda.mjs` e atualiza o código da Lambda. Esta é uma pipeline de **publicação da aplicação**. O fluxo dos dados de interesse continua sendo navegador → CloudFront → API Gateway → Lambda → DynamoDB. Os workflows não criam nem alteram a configuração da tabela, da API, do WAF ou das origens do CloudFront.

Os exemplos abaixo usam **identificadores fictícios**. Em qualquer trecho com `<COLE_..._AQUI>`, substitua pelo valor do **seu** ambiente antes de salvar no console. Não copie identificadores de outra conta. O segredo `ORIGIN_VERIFY_SECRET` e o valor de `X-Origin-Verify` não entram nos workflows nem no repositório: a implantação da Lambda atualiza o **pacote de código**, preservando as variáveis de ambiente já configuradas na função.

### 10.1. Localizar os valores necessários no Console AWS e no GitHub

| Marcador nos exemplos | Onde encontrar o valor a colar |
| --- | --- |
| `<COLE_ID_DA_CONTA_AWS_AQUI>` | Console AWS → menu da conta, no canto superior direito → **ID da conta**. É o número de 12 dígitos usado nos ARNs. |
| `<COLE_NOME_DO_BUCKET_AQUI>` | Console AWS → **S3 → Buckets** → coluna **Nome** do bucket que contém `index.html`. Bucket tem **nome**, não um ID numérico. |
| `<COLE_ID_DA_DISTRIBUICAO_AQUI>` | Console AWS → **CloudFront → Distribuições** → coluna **ID** da distribuição que atende o site. Copie o **ID**, não o domínio `*.cloudfront.net`. |
| `<COLE_DOMINIO_CLOUDFRONT_AQUI>` | Na mesma lista do CloudFront, copie a coluna **Nome de domínio**. Este valor serve para abrir o site no navegador, não para `--distribution-id`. |
| `<COLE_NOME_DA_FUNCAO_AQUI>` | Selecione **Ohio (`us-east-2`)** → **Lambda → Funções** → coluna **Nome da função**. Na página da função, a visão geral também mostra o ARN completo. |
| `<COLE_ARN_DO_PERFIL_AQUI>` | Console AWS → **IAM → Perfis/Funções (Roles)** → perfil de implantação → campo **ARN**. Esse valor vai na variável `AWS_DEPLOY_ROLE_ARN` do GitHub. |
| `<COLE_USUARIO_OU_ORGANIZACAO_AQUI>` e `<COLE_REPOSITORIO_AQUI>` | GitHub → página do repositório: os dois nomes aparecem antes do caminho do projeto, no formato `usuario/repositorio`. Use os nomes exatos, respeitando a grafia. |

O ARN é um identificador de recurso, e não uma senha. Mesmo assim, os exemplos deste README omitem os identificadores reais da conta. Nunca publique uma chave de acesso AWS, token ou o valor do cabeçalho compartilhado.

### 10.2. Criar a entidade externa OIDC na AWS

1. No **Console AWS → IAM → Provedores de identidade → Adicionar provedor**, escolha **OpenID Connect**.
2. Em **URL do provedor**, informe `https://token.actions.githubusercontent.com`. Em **Público/Audience**, informe `sts.amazonaws.com`. Esses dois valores são **padrões da integração GitHub Actions com AWS**, não IDs da sua conta GitHub.
3. Crie o provedor. Ele representa a identidade externa que emitirá um token para cada execução autorizada. **Não** crie usuário IAM nem chave de acesso permanente para o runner.

O GitHub só recebe credenciais **temporárias** da AWS quando o workflow pede um token OIDC e a política de confiança do perfil aceita o repositório e a branch indicados. A URL do provedor por si só não concede acesso aos recursos.

### 10.3. Criar a política de permissões para a publicação

No **IAM → Políticas → Criar política → JSON**, use uma política com apenas as ações necessárias. Substitua **cada** marcador `<COLE_..._AQUI>` pelos valores localizados em 10.1; os marcadores são didáticos e não são ARNs válidos enquanto não forem trocados. Depois escolha **Próximo**, dê um nome como `publicar-aplicacao-exemplo` e crie a política.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListarBucketDoSite",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::<COLE_NOME_DO_BUCKET_AQUI>"
    },
    {
      "Sid": "PublicarArquivosDoSite",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::<COLE_NOME_DO_BUCKET_AQUI>/*"
    },
    {
      "Sid": "InvalidarCacheDaDistribuicao",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<COLE_ID_DA_CONTA_AWS_AQUI>:distribution/<COLE_ID_DA_DISTRIBUICAO_AQUI>"
    },
    {
      "Sid": "AtualizarCodigoDaFuncao",
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:GetFunctionConfiguration"
        ]
      "Resource": "arn:aws:lambda:us-east-2:<COLE_ID_DA_CONTA_AWS_AQUI>:function:<COLE_NOME_DA_FUNCAO_AQUI>"
    }
  ]
}
```

`s3:ListBucket` permite ao `aws s3 sync` comparar os objetos existentes; `s3:PutObject` permite enviar os arquivos compilados. `cloudfront:CreateInvalidation` apenas pede que o CloudFront descarte cópias em cache; **não** muda a configuração da distribuição. `lambda:UpdateFunctionCode` atualiza o pacote da função; **não** altera seu perfil de execução, suas variáveis de ambiente ou as permissões de gravação no DynamoDB. `lambda:GetFunctionConfiguration` permite consultar o estado e as configurações da função para que o comando `aws lambda wait function-updated` confirme que a atualização terminou; essa permissão não permite modificar a função. O `sync` atual não usa `--delete`, então esta política não concede `s3:DeleteObject`. A política é anexada ao **perfil de implantação do GitHub**, não ao perfil que a Lambda usa para executar.

### 10.4. Criar o perfil IAM e limitar sua relação de confiança

1. No **IAM → Perfis/Funções (Roles) → Criar perfil**, selecione **Identidade Web**. Escolha o provedor `token.actions.githubusercontent.com` e o público `sts.amazonaws.com`.
2. Em **GitHub organization**, coloque `<COLE_USUARIO_OU_ORGANIZACAO_AQUI>`. Em **GitHub repository** e **GitHub branch**, coloque o repositório escolhido e `main`. Evite `*` nesses campos: este projeto só publica após a mudança entrar em `main`.
3. Em **Adicionar permissões**, selecione apenas a política criada em 10.3. Dê um nome como `deploy-github-exemplo`, revise e crie o perfil.
4. Abra o perfil → **Relações de confiança → Editar política de confiança**. Confira se `aud` é `sts.amazonaws.com` e se `sub` corresponde **exatamente** ao dono, repositório e branch. A condição esperada tem este formato:

```json
{
  "StringEquals": {
    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub": "repo:<COLE_USUARIO_OU_ORGANIZACAO_AQUI>/<COLE_REPOSITORIO_AQUI>:ref:refs/heads/main"
  }
}
```

Esse trecho mostra **somente a condição** da política de confiança; o console gera também o principal federado e a ação `sts:AssumeRoleWithWebIdentity`. Verifique se o ARN do principal aponta para o provedor OIDC **da sua própria conta**. Não inclua barras invertidas, tabulações ou caracteres extras no valor de `sub`. Essa política responde **quem pode assumir** o perfil; a política de 10.3 responde **o que o perfil pode fazer**. O perfil de execução da Lambda é outro perfil, usado quando a função roda.

### 10.5. Configurar o repositório no GitHub

1. No repositório, abra **Settings → Secrets and variables → Actions → Variables → New repository variable**.
2. Crie a variável `AWS_DEPLOY_ROLE_ARN` e cole em **Value** o ARN do perfil localizado em 10.1. O workflow usa `${{ vars.AWS_DEPLOY_ROLE_ARN }}`. Essa variável é uma configuração do deploy, **não** o segredo entre CloudFront e Lambda.
3. Confira que **Actions** está habilitado no repositório. O fluxo adotado é trabalhar em uma branch de tarefa, abrir um *pull request* para `main`, obter a aprovação exigida pelas regras do repositório e então fazer o *merge*. O *merge* gera um `push` em `main`, que pode iniciar os workflows.

O provedor OIDC é criado **uma vez por conta AWS**. Já a política de confiança deve continuar restrita ao repositório e à branch de implantação. Se o ARN da variável estiver vazio ou apontar para outro perfil, a etapa de obter credenciais falhará. Se aparecer `AccessDenied` para um serviço, confira as ações e os ARNs da política anexada ao **perfil de implantação**.

### 10.6. Entender os dois arquivos YAML do GitHub Actions

Os arquivos deste projeto são [`.github/workflows/deploy-frontend.yml`](.github/workflows/deploy-frontend.yml) e [`.github/workflows/deploy-lambda.yml`](.github/workflows/deploy-lambda.yml). O diretório obrigatório é **`.github/workflows/`**, no plural. O GitHub procura nessa pasta os arquivos `.yml` ou `.yaml` que definem workflows; salvar o mesmo conteúdo em `.github/workflow/` ou em outra pasta não o registra como workflow. O arquivo define **quando** executar, **em qual runner** e **quais passos** rodar. Criar o arquivo já deixa o workflow disponível no GitHub; ele só executa quando ocorre um evento configurado ou quando alguém o inicia manualmente.

| Parte do YAML | Significado neste projeto |
| --- | --- |
| `name` | Nome exibido na aba **Actions**. |
| `on.push.branches: [main]` | Executa quando um novo commit entra na branch remota `main`, inclusive após um merge de PR. Um push na branch de tarefa não publica. |
| `on.push.paths` | Filtro de arquivos para o evento `push`: o frontend observa `src/**`, `public/**`, `index.html`, manifestos npm e o próprio YAML; a Lambda observa `backend/**` e seu YAML. Um commit só no README não inicia nenhum dos dois. |
| `workflow_dispatch` | Permite iniciar manualmente pela aba **Actions**, mesmo sem uma mudança nos caminhos filtrados. Confirme a branch selecionada antes de clicar em **Run workflow**. |
| `permissions: contents: read` | Autoriza o checkout do código do repositório. |
| `permissions: id-token: write` | Permite solicitar ao GitHub um token OIDC para assumir o perfil IAM. Não concede por si só acesso ao S3 ou à Lambda. |
| `concurrency` | Agrupa execuções do mesmo workflow para evitar publicações simultâneas. `cancel-in-progress: false` mantém a execução em andamento. Cada YAML usa um grupo diferente. |
| `jobs.publicar` e `runs-on: ubuntu-latest` | Definem o trabalho e um **runner** Linux temporário fornecido pelo GitHub. Os comandos `run` executam nesse runner, não no seu PC nem em uma EC2 sua. |
| `steps`, `name`, `uses`, `with` | Cada *step* tem um nome; `uses` chama uma action reutilizável e `with` passa suas opções. `actions/checkout` baixa o código e `actions/setup-node` instala a versão do Node e prepara o cache npm. |
| `run` e `run: |` | `run` executa comandos no runner. O `|` do YAML preserva **várias linhas** como um único bloco de comandos; não é um operador de permissão nem uma chamada à API. |
| `aws-actions/configure-aws-credentials`, `role-to-assume`, `aws-region` | A action troca o token OIDC por credenciais temporárias do perfil indicado em `AWS_DEPLOY_ROLE_ARN`. Os dois deploys usam `us-east-2` para S3 e Lambda; o comando CloudFront alcança o serviço global. |
| `${{ github.run_id }}` | Identificador de **cada execução** usado no nome da sessão IAM para facilitar a identificação do deploy. Não é ID do bucket, da distribuição ou da conta. |

**Workflow do frontend.** `npm ci` instala exatamente as versões do `package-lock.json`; `npm run build` faz o Vite gerar `dist/`. `aws s3 sync dist/ s3://<COLE_NOME_DO_BUCKET_AQUI>/` envia os arquivos para a **raiz** do bucket. Em seguida, `aws cloudfront create-invalidation --distribution-id <COLE_ID_DA_DISTRIBUICAO_AQUI> --paths '/*'` solicita ao CloudFront que busque novamente os caminhos ao receber novos pedidos. Esses comandos são **modelos explicativos** com marcadores: no YAML executável, os valores devem apontar para os recursos reais do seu ambiente. A invalidação pode levar algum tempo; o workflow terminar não significa que todas as bordas já receberam a mudança.

**Workflow da Lambda.** `node --check backend/lambda.mjs` verifica a **sintaxe**, não o comportamento da função. `npm ci --prefix backend --omit=dev` instala no diretório `backend` as dependências de produção travadas no `backend/package-lock.json`. O bloco `run: |` copia `lambda.mjs` para `index.mjs`, entra em `backend/` e cria `lambda-deploy.zip` com `index.mjs`, `package.json` e `node_modules`. Isso mantém o handler configurado como `index.handler`. `aws lambda update-function-code --function-name <COLE_NOME_DA_FUNCAO_AQUI> --zip-file fileb://lambda-deploy.zip` envia o pacote; `aws lambda wait function-updated` aguarda a atualização da função. Esse fluxo não altera automaticamente as variáveis `VISITS_TABLE` e `ORIGIN_VERIFY_SECRET`.

As duas publicações são **independentes**. Se um commit em `main` mudar frontend e backend, ambos os workflows podem executar; se mudar apenas `backend/**`, só a Lambda é publicada. Os filtros `paths` selecionam workflows inteiros: não fazem uma comparação extra de conteúdo dentro de cada step. Como o deploy usa o perfil OIDC, não é preciso colocar credenciais AWS permanentes nos *Secrets* do GitHub. Os identificadores de recurso que aparecem no YAML são parâmetros de destino, não mecanismos de autenticação.

### 10.7. Confirmar cada publicação

No GitHub, abra **Actions → workflow → execução → job publicar** e confira cada step. Para o frontend, confirme no **Console AWS → S3 → bucket → Objetos** a data dos arquivos publicados e, em **CloudFront → distribuição → Invalidations**, a solicitação criada. Para o backend, selecione **Ohio → Lambda → função → Código** e confira a última modificação; depois faça um registro de interesse controlado e confira o `204` e o item no DynamoDB. Se o workflow falhar, abra o step vermelho: falha de `sts:AssumeRoleWithWebIdentity` aponta para perfil, variável ou confiança OIDC; `AccessDenied` em `UpdateFunctionCode`, S3 ou CloudFront aponta para a política de permissões. Um check verde confirma a execução dos comandos, mas a verificação funcional ainda depende do teste pelo site.

## Por que o cabeçalho personalizado e a variável da Lambda

O endereço público da HTTP API pode ser chamado sem passar pelo CloudFront. Como o WAF está associado somente à distribuição, uma chamada direta também não passa por suas regras. Para que uma chamada direta **sem o valor esperado** não grave um item no DynamoDB, o CloudFront acrescenta o cabeçalho `X-Origin-Verify` **na comunicação com a origem API Gateway**. O navegador não recebe nem precisa conhecer esse valor. O API Gateway encaminha a requisição à Lambda, que compara o cabeçalho recebido com `ORIGIN_VERIFY_SECRET` e responde `403` antes da gravação se ele estiver ausente ou incorreto. A variável de ambiente mantém o valor fora do código publicado no S3 e permite alterá-lo sem modificar o frontend.

**Limite importante:** isso não torna a HTTP API privada nem prova que a requisição veio de um navegador. Uma chamada direta sem o cabeçalho **ainda chega ao API Gateway e invoca a Lambda**; o que é negado é o registro no DynamoDB. Quem obtiver o valor poderá enviá-lo diretamente ao `execute-api`, e um terminal também pode chamar o domínio do CloudFront como qualquer outro cliente. Portanto, a afirmação correta é: **sem conhecer o valor, a chamada direta não passa pela validação da Lambda**. Esse controle não elimina custos de tentativas diretas nem substitui autenticação de usuários, limites de requisições e proteção específica da API. O valor deve permanecer privado e ser atualizado de forma coordenada no CloudFront e na Lambda se houver suspeita de exposição.

## O que o frontend e a Lambda registram

O arquivo [`src/analytics.js`](src/analytics.js) lê [`public/config.json`](public/config.json) e envia o POST **somente no clique**. O corpo contém um `eventId` UUID v4 e `source`. O `source` usa `utm_source` da URL quando válido; caso contrário, pode usar o domínio do referenciador ou `direct`. Esses campos enviados pelo navegador são entradas não confiáveis e não servem para autorizar a requisição.

A Lambda grava `eventId`, `source`, `country`, `region`, `visitedAt` em UTC, `visitedAtLocal`, `timeZone` e `expiresAt`. País, região e fuso dependem dos cabeçalhos recebidos da origem CloudFront; podem ficar `unknown` ou `UTC`. **O código atual não grava `eventType`, endereço IP ou dados de cadastro.** Outros serviços da AWS podem manter logs técnicos próprios, inclusive endereços IP.

O navegador guarda `orbita-interest-event-id` e `orbita-interest-confirmed` em `localStorage` para manter o botão como **Registrado** após recarregar e reduzir reenvios. Se uma tentativa falhar, o mesmo `eventId` pode ser reutilizado; a escrita condicional da Lambda evita uma segunda linha para esse ID. Isso não identifica uma pessoa entre navegadores ou após limpar os dados locais.

## Testes de segurança feitos até aqui

Os testes foram feitos **na própria distribuição do projeto**, sem modificar o frontend para executar conteúdo recebido na URL. Um padrão detectado pelo WAF não significa que uma vulnerabilidade tenha sido explorada.

| Teste | Observação no projeto | O que demonstra |
| --- | --- | --- |
| String parecida com XSS em parâmetro de URL, por exemplo `?teste=%3Cscript%3Ealert%281%29%3C%2Fscript%3E` | Com a regra em **Count**, o WAF contou a correspondência e a página abriu. Depois de colocar `CrossSiteScripting_QUERYARGUMENTS` em **Block**, uma solicitação de teste recebeu **403** do CloudFront. | A regra pode reconhecer e bloquear essa assinatura na query string. Não prova que o site tivesse XSS refletido: a página não interpretou o parâmetro como HTML. |
| String de travessia de caminho/LFI em `arquivo`, como `?arquivo=..%2F..%2Fconfig.json` | A métrica `GenericLFI_QUERYARGUMENTS` apareceu em **Count**. | O WAF reconheceu um padrão de tentativa; não houve leitura de arquivo pelo aplicativo. Acessar `/config.json` como objeto público do site é diferente de explorar LFI. |
| Correspondência `CrossSiteScripting_COOKIE` | Surgiu em métricas **Count** durante navegação, inclusive em pedidos de arquivos estáticos. Não foi enviado um cookie de ataque intencional nesse teste. | É preciso examinar uma ocorrência nos logs do WAF para saber qual campo foi considerado suspeito. A métrica sozinha não identifica o cookie nem comprova um ataque. |
| POST direto ao endereço `execute-api` sem o cabeçalho esperado | A Lambda responde **403** e não grava o item. | Validação do valor antes da escrita. A chamada ainda alcança o API Gateway e invoca a função. |
| POST pelo domínio CloudFront após clicar no botão | A resposta esperada é **204**, com um novo item na tabela; o botão passa a **Registrado**. | Integração do caminho `/api/*` com API Gateway, Lambda e DynamoDB. O status e o item devem ser verificados juntos. |

Para investigar um evento novo, procure a requisição pelo horário, URI, ação e regra em **WAF → ACL → painel/solicitações em amostra**; se a amostra não trouxer detalhes suficientes, use o grupo `aws-waf-logs-*` no **CloudWatch Logs em `us-east-1`**. Uma resposta 403, isoladamente, não identifica qual regra a produziu: confirme a ação no log.

## Executar, atualizar e verificar

```sh
npm ci
npm run dev
npm run build
npm run preview
```

`npm run dev` serve para desenvolvimento local. `npm run build` gera os arquivos estáticos em `dist/`; `npm run preview` permite inspecionar localmente essa compilação. Na publicação manual, carregue **o conteúdo** de `dist/` na raiz do bucket S3. Na publicação automática, o workflow do frontend faz o build, sincroniza `dist/` e cria uma **invalidação** `/*` no CloudFront após o merge em `main`. O workflow separado da Lambda publica o pacote quando `backend/**` muda. Arquivos antigos com nomes diferentes podem permanecer no bucket, pois o comando atual não usa `--delete`. Uma invalidação nova não exige apagar as anteriores; elas são registros de operações já feitas.

No navegador, abra **DevTools → Network**: antes do clique, não deve haver `POST /api/visits`; após o clique, confira o `204` e o item no DynamoDB. Recarregue a página para verificar que o botão permanece confirmado no mesmo navegador. Confira também o CloudFront/WAF: uma solicitação bloqueada pela regra de XSS deve aparecer como **Block**, enquanto regras em Count apenas contabilizam. Caso a API falhe, o site estático continua abrindo e o botão permite nova tentativa.

## Arquivos principais

```text
src/main.jsx              interface React e botão de interesse
src/Universe.jsx          cena espacial com Three.js
src/style.css             estilos
src/analytics.js          envio do interesse e persistência local
public/config.json        configuração pública do endpoint relativo
backend/lambda.mjs        código de referência da função Lambda
backend/package.json      dependências do backend
docs/arquitetura-orbita.svg  diagrama da implantação
.github/workflows/deploy-frontend.yml  build do Vite, S3 e invalidação do CloudFront
.github/workflows/deploy-lambda.yml    pacote e atualização do código da Lambda
```

`dist/` e `node_modules/` são gerados localmente e ignorados pelo Git. O valor do cabeçalho privado não deve ser incluído no repositório, no pacote do frontend ou em capturas públicas do Console AWS.

## Referências oficiais

- [Vite: implantação de site estático](https://vite.dev/guide/static-deploy)
- [CloudFront: restringir acesso ao S3 com OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- [CloudFront: adicionar cabeçalhos personalizados às origens](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html)
- [CloudFront: política gerenciada AllViewerExceptHostHeader](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
- [Lambda Node.js: versão do AWS SDK incluída no runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
- [AWS WAF: criar uma Web ACL para CloudFront](https://docs.aws.amazon.com/waf/latest/developerguide/web-acl-creating.html)
- [AWS WAF: enviar logs ao CloudWatch Logs](https://docs.aws.amazon.com/waf/latest/developerguide/logging-cw-logs.html)
- [AWS WAF: ações Count e Block](https://docs.aws.amazon.com/waf/latest/APIReference/API_RuleAction.html)
- [GitHub Actions: sintaxe e localização dos workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub Actions: OIDC com AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [GitHub Actions: variáveis de configuração](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables)
- [AWS IAM: criar perfil para provedor OIDC do GitHub](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html)
- [AWS IAM: criar política no editor JSON](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_create-console.html)
