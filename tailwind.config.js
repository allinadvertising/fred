/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Sora"', '"DM Sans"', 'Inter', 'system-ui', 'sans-serif'],
        body: ['"DM Sans"', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        canvas: '#0b1221',
        card: '#0f172a',
        accent: '#36bffa'
      },
      boxShadow: {
        soft: '0 10px 60px rgba(15, 23, 42, 0.25)'
      }
    }
  },
  plugins: []
};
