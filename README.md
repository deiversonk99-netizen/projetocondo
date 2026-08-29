# Mapa Duo Jardim Paraíso

Aplicativo público de navegação interna do condomínio baseado em coordenadas X/Y. O usuário escolhe um ponto de partida, adiciona uma ou várias casas, quadras ou áreas comuns e o app otimiza a ordem das paradas pela malha de ruas.

## Acesso público

O mapa foi criado para ficar disponível pela web, sem cadastro, login ou geolocalização. Depois da implantação na Vercel, qualquer pessoa com o endereço do aplicativo poderá consultar o condomínio e planejar rotas pelo celular ou computador.

## Funcionalidades atuais

- 316 casas cadastradas, das quadras A a L.
- Busca por casa (`A18` ou `Casa A18`), quadra e área comum.
- Seleção de casa diretamente no mapa.
- Roteamento com até 20 pontos de entrega, sem GPS.
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
- `src/components/CondoMap.tsx`: busca, interação e SVG do mapa.
- `public/mapa-esquematico.png`: representação visual independente usada pelo aplicativo.
- `scripts/generate_schematic_map.py`: gerador reproduzível do mapa e da imagem de compartilhamento.

O repositório não inclui a planta arquitetônica do condomínio. O mapa publicado é uma representação
funcional própria, desenhada somente com as informações necessárias à navegação: ruas internas,
quadras, numeração das casas, portaria, áreas comuns e coordenadas X/Y.

## Ajustes antes do uso oficial

A malha esquemática precisa ser conferida no condomínio, principalmente sentidos de circulação,
acessos permitidos e caminhos exclusivos para pedestres. Como o desenho não tem escala técnica,
a distância exibida usa unidades visuais X/Y, não metros.
