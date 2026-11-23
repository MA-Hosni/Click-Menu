import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Click Menu";
const description = "Discover restaurant menus with Click Menu.";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";

/** The browser bar matches the page in light and dark mode. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#161a13" },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),

  title,
  description,

  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },

  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Click Menu",
    images: [
      {
        url: "/og.jpg",
        width: 1200,
        height: 630,
        alt: "Click Menu",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
