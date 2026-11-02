export default function Card({ children, className = '' }) {
  return <section className={`rounded-lg border border-ink/10 bg-white p-6 shadow-soft ${className}`}>{children}</section>;
}
