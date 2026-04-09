/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        sidebar: {
          DEFAULT: 'var(--color-sidebar)',
          hover: 'var(--color-sidebar-hover)',
          active: 'var(--color-sidebar-active)',
          text: 'var(--color-sidebar-text)',
          'text-active': 'var(--color-sidebar-text-active)',
          border: 'var(--color-sidebar-border)',
        },
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        muted: 'var(--color-muted)',
        text: {
          DEFAULT: 'var(--color-text)',
          secondary: 'var(--color-text-secondary)',
        },
      },
      backgroundColor: {
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        sidebar: 'var(--color-sidebar)',
      },
      borderColor: {
        border: 'var(--color-border)',
        sidebar: 'var(--color-sidebar-border)',
      },
      textColor: {
        muted: 'var(--color-muted)',
        primary: 'var(--color-text)',
      },
    },
  },
  plugins: [],
};
