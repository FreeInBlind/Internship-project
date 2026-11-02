/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#171918',
        mint: '#dff4e9',
        orange: '#ef8f52',
        paper: '#fbfaf7',
      },
      boxShadow: {
        soft: '0 18px 50px rgba(23, 25, 24, 0.08)',
      },
    },
  },
  plugins: [],
};
