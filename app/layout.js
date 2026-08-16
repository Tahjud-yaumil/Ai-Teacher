export const metadata = {
  title: 'YaumiTeach',
  description: 'AI Teaching Assistant untuk guru MTs',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
