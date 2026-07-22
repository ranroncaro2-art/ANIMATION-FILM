import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TOOL ANIMATION FILM PRO - Storyboard to Veo 3 Production",
  description: "Automate translation of text storyboards into character references, shots, keyframes, and Veo 3 motion prompts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
