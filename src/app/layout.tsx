import type { Metadata } from "next";
import "./globals.css";

const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(productionUrl),
  title: "Mapa Duo Jardim Paraíso",
  description: "Localize casas, quadras e pontos de interesse no condomínio.",
  openGraph: {
    title: "Mapa Duo Jardim Paraíso",
    description: "Encontre casas, quadras e áreas comuns com rotas em coordenadas X/Y.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Mapa Duo Jardim Paraíso" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mapa Duo Jardim Paraíso",
    description: "Encontre casas, quadras e áreas comuns com rotas em coordenadas X/Y.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
