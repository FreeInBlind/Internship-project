import React from 'react';
import Link from 'next/link';

export default function Button({ children, href, variant = 'primary', className = '', ...props }) {
  const classes = `inline-flex min-h-11 items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition ${variant === 'secondary' ? 'border border-ink/20 bg-white text-ink hover:bg-ink hover:text-white' : 'bg-ink text-white hover:bg-orange'} ${className}`;
  if (href && href.startsWith('/')) return <Link href={href} className={classes} {...props}>{children}</Link>;
  if (href) return <a href={href} className={classes} {...props}>{children}</a>;
  return <button className={classes} {...props}>{children}</button>;
}
