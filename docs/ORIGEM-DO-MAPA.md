# Origem e uso da planta

O aplicativo utiliza `public/planta-condominio.svg`, arquivo fornecido pelo responsável pelo
repositório como base visual da navegação. O arquivo é exibido rotacionado para a orientação do mapa;
carimbo, observações, identificadores de assinatura eletrônica e a indicação de área reservada ficam
fora da apresentação visual do aplicativo. A versão publicada também remove vegetação, marcações
de entradas de garagem e linhas técnicas que não ajudam na navegação. As linhas estruturais antes
vermelhas foram uniformizadas em preto, preservando ruas, quadras, lotes e numeração das casas.

A limpeza é reproduzível pelo script `scripts/optimize_floor_plan_svg.py`. Ela reduz a complexidade
e o tamanho do arquivo sem alterar as coordenadas funcionais usadas pelo sistema de roteirização.

A busca e a roteirização usam dados funcionais próprios e não dependem das entidades internas do
arquivo SVG:

- identificação e coordenadas X/Y das casas em `src/data/houses.json`;
- pontos de interesse, nós e conexões das ruas em `src/data/map.ts`.

Opcionalmente, o usuário pode autorizar o GPS. Dois pontos conhecidos relacionam latitude/longitude
às coordenadas X/Y; as leituras seguintes são convertidas e ajustadas à rua mais próxima. A calibração
fica no armazenamento local do navegador, as coordenadas podem ser conferidas na interface e não são
enviadas para um servidor pelo app. Esse fluxo não utiliza Google Maps nem outra API cartográfica.

## Autoria e autorização

O repositório e o aplicativo não reivindicam autoria sobre a planta arquitetônica. A inclusão do
arquivo no projeto não transfere nem comprova direitos de reprodução. A disponibilização pública
deve ocorrer somente com autorização do autor ou titular dos direitos, preferencialmente por escrito,
incluindo permissão para uso digital, adaptação visual, hospedagem e divulgação.

## Limites

O mapa serve somente para orientação interna e roteirização por coordenadas. Não é projeto
arquitetônico, levantamento topográfico nem representação em escala técnica. Sentidos de circulação,
acessos e caminhos permitidos devem ser conferidos no local.
O rastreamento GPS é um auxílio sujeito à precisão informada pelo aparelho e não substitui a
confirmação visual da posição dentro do condomínio.

