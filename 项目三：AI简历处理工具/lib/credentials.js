import bcrypt from 'bcryptjs';

export const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const isValidEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const passwordBytesValid = (value) => typeof value === 'string' && [...value].length >= 12 && [...value].length <= 72 && Buffer.byteLength(value, 'utf8') <= 72;
export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);
