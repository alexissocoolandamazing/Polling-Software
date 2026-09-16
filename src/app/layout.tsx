import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PulsePoll", template: "%s · PulsePoll" },
  description: "Fast, real-time audience polling for live events.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
