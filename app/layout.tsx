import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { brandAssets } from "@/lib/brand-assets";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const manrope = localFont({
  src: "../branding/fonts/Manrope-Variable.ttf",
  weight: "200 800",
  style: "normal",
  variable: "--font-display",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000"),
  applicationName: "Servio",
  manifest: "/brand/servio/site.webmanifest",
  title: {
    default: "Servio",
    template: "%s · Servio",
  },
  description:
    "An open-source service desk with Sable, your AI teammate. Tickets, knowledge, changes, assets and self-service, with human approval for AI actions.",
  openGraph: { title: "Servio — Service, in flow.", siteName: "Servio", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: brandAssets.colors.mist },
    { media: "(prefers-color-scheme: dark)", color: brandAssets.colors.navy },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${manrope.variable} ${jetbrains.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider locale={locale}>
            {children}
            <Toaster richColors position="top-right" />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
