import type { Metadata } from "next";
import "./globals.css";
import LenisProvider from "./components/LenisProvider";
import CustomCursor from "./components/CustomCursor";

export const metadata: Metadata = {
  title: "Washly — Smart Laundry, Simply Done",
  description: "Your intelligent laundry companion. Five wash modes. One calm interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <LenisProvider>
          <CustomCursor />
          {children}
        </LenisProvider>
      </body>
    </html>
  );
}
