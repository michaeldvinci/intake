import "./globals.css";
import { Sidebar } from "./components/Sidebar";

export const metadata = {
  title: "Intake",
  description: "Self-hosted macros + weight + steps tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
      </head>
      <body>
        <div className="shell">
          <Sidebar>
            <main className="main-content">
              {children}
            </main>
          </Sidebar>
        </div>
      </body>
    </html>
  );
}
