# Mapa Duo Jardim Paraíso

Aplicativo público de navegação interna do condomínio baseado em coordenadas X/Y. O usuário escolhe um ponto de partida, adiciona uma ou várias casas, quadras ou áreas comuns e o app otimiza a ordem das paradas pela malha de ruas.

## Acesso público

O mapa foi criado para ficar disponível pela web, sem cadastro ou login. A localização do celular é opcional e só é acessada depois que o usuário ativa o GPS e autoriza o navegador. Também é possível continuar usando o mapa inteiramente pelo ponto de partida manual.

## Funcionalidades atuais

- 316 casas cadastradas, das quadras A a L.
- Busca por casa (`A18` ou `Casa A18`), quadra e área comum.
- Seleção de casa diretamente no mapa.
- Roteamento com até 20 destinos, usando partida manual ou GPS calibrado.
- Rastreamento híbrido: latitude/longitude convertidas para X/Y e ajustadas à rua mais próxima.
- Calibração por dois pontos conhecidos, salva somente no aparelho do usuário.
- Exibição da precisão informada pelo GPS e atualização contínua da rota ativa.
- Otimização automática da ordem das paradas.
- Instruções e distância de cada trecho pela sequência de ruas.
- Zoom, movimentação e destaque visual da rota.
- Layout responsivo para celular e computador.
- Página estática, sem banco de dados ou serviço externo.

## Executar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Validar a versão de produção

```bash
npm run build
npm run start
```

## Implantação na Vercel

Importe este repositório em um novo projeto da Vercel. O framework e os comandos de build são detectados automaticamente.

Não é necessário cadastrar variáveis de ambiente. A Vercel fornece `VERCEL_PROJECT_PRODUCTION_URL`, usado apenas para montar os metadados de compartilhamento.

## Organização do mapa

- `src/data/houses.json`: coordenadas e identificação das 316 casas.
- `src/data/map.ts`: pontos de interesse, nós e ligações das ruas.
- `src/lib/routing.ts`: encaixe dos pontos na rua, menor rota e otimização de múltiplas paradas.
- `src/lib/gpsTracking.ts`: calibração, conversão GPS para X/Y e ajuste à malha de ruas.
- `src/components/CondoMap.tsx`: busca, interação e SVG do mapa.
- `public/planta-condominio.svg`: planta vetorial otimizada para o mapa, sem vegetação, carimbos e marcações técnicas de acesso.
- `scripts/optimize_floor_plan_svg.py`: reproduz a limpeza e a compactação do SVG original.

## Ajustes antes do uso oficial

A malha das ruas e as posições precisam ser conferidas no local, principalmente sentidos de
circulação, acessos permitidos e caminhos exclusivos para pedestres. A planta SVG é uma referência
visual e não substitui projeto arquitetônico ou levantamento topográfico. A distância exibida usa
unidades visuais X/Y, não metros. Antes da publicação, confirme a autorização do titular dos direitos
da planta para reprodução e disponibilização pública. O GPS pode apresentar variações, especialmente
entre construções; confira a precisão mostrada na tela e mantenha a opção manual disponível.

