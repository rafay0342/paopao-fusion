import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaoPao Fusion: The Shattered Crown",
  description:
    "A cinematic bubble-shooter adventure with touch, pointer, keyboard and hand-tracking controls.",
  icons: {
    icon: "/assets/icons/favicon.ico",
    shortcut: "/assets/icons/favicon-32.png",
    apple: "/assets/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
