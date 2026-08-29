# Origem e independência do mapa

O mapa publicado pelo aplicativo é uma representação funcional original em SVG. Ele é construído
em tempo de execução a partir de dois conjuntos de dados do próprio sistema:

- identificação e coordenadas X/Y das casas em `src/data/houses.json`;
- pontos de interesse, nós e conexões das ruas em `src/data/map.ts`.

## Elementos deliberadamente não reutilizados

- imagem raster ou página do PDF da planta arquitetônica;
- cores, espessuras de linha e convenções gráficas de CAD;
- tipografia técnica, carimbo, legendas, hachuras ou tracejados do projeto;
- árvores, rosa dos ventos, símbolos e demais blocos gráficos do documento;
- cotas, detalhes construtivos, recuos de telhado e informações contratuais.

## Linguagem visual própria

O desenho utiliza uma paleta web em tons de `slate`, `teal` e cores sólidas para áreas comuns.
Casas são representadas por formas geométricas simples, ruas por faixas neutras e vegetação por
círculos estilizados. A tipografia usa a pilha `Inter, Arial, sans-serif`.

## Limites

O mapa serve somente para orientação interna e roteirização por coordenadas. Não é projeto
arquitetônico, levantamento topográfico nem representação em escala técnica. A conferência de
sentidos de circulação, acessos e caminhos permitidos deve ser feita no local.

Esta documentação registra o processo técnico adotado, mas não substitui uma análise jurídica nem
uma autorização escrita do titular quando houver intenção de reproduzir elementos do projeto
arquitetônico original.

