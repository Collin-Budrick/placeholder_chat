module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        accent: '#F8E58C',
      },
    },
  },
  plugins: [require('daisyui'), require('tailwindcss-animate')],
  daisyui: {
    styled: true,
    // Define light and OLED-dark themes; DaisyUI computes readable text automatically
    // Align with app theme names: 'light' and 'dark'
    themes: [
      {
        light: {
          primary: '#F8E58C',
          secondary: '#111111',
          accent: '#F8E58C',
          neutral: '#111111',
          'base-100': '#ffffff',
          info: '#60a5fa',
          success: '#4ade80',
          warning: '#facc15',
          error: '#f87171',
        },
      },
      {
        dark: {
          primary: '#F8E58C',
          secondary: '#FFFFFF',
          accent: '#F8E58C',
          neutral: '#1a1a1a',
          'base-100': '#000000',
          info: '#93c5fd',
          success: '#86efac',
          warning: '#fde68a',
          error: '#fca5a5',
        },
      },
    ],
    base: true,
    // Drop DaisyUI utility classes to trim CSS size; rely on Tailwind utilities instead
    utils: false,
    logs: false,
  },
};
