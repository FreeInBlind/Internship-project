import NextAuth from 'next-auth';
import { authOptions } from '../../../lib/auth';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  return NextAuth(req, res, authOptions);
}
