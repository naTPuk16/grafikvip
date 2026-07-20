import "./globals.css";

export const metadata = {
  title: "График ВИП",
  description: "Форма и таблица графика смен"
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
