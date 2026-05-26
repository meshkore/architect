/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Aligned with webapp/ design system so the brand reads consistently
      // between meshkore.com (public) and architect.meshkore.com (cockpit).
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      // V80 design tokens — surfaced as Tailwind utilities. All point at
      // the CSS custom properties declared in src/index.css :root so
      // the single source of truth stays the CSS file. New code should
      // prefer these semantic names over raw `gray-*` (which V80
      // remapped via legacy overrides in index.css).
      colors: {
        canvas:       'var(--bg-canvas)',
        page:         'var(--bg-page)',
        panel:        'var(--bg-panel)',
        'panel-alt':  'var(--bg-panel-alt)',
        bar:          'var(--bg-bar)',
        card:         'var(--bg-card)',
        'card-hover': 'var(--bg-card-hover)',
        input:        'var(--bg-input)',
        // Five-tier text scale (V68).
        primary: 'var(--text-primary)',
        strong:  'var(--text-strong)',
        body:    'var(--text-body)',
        muted:   'var(--text-muted)',
        faint:   'var(--text-faint)',
      },
      borderColor: {
        col:        'var(--border-col)',
        'col-glow': 'var(--border-col-glow)',
        bar:        'var(--border-bar)',
        soft:       'var(--border-soft)',
      },
      boxShadow: {
        panel:        'var(--panel-shadow)',
        bar:          'var(--bar-shadow)',
        card:         'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hov)',
      },
      borderRadius: {
        panel: 'var(--panel-radius)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        slideUp: {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        pulseSoft: { '0%, 100%': { opacity: 0.65 }, '50%': { opacity: 1 } },
      },
    },
  },
  plugins: [],
};
