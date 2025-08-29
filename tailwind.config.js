/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/templates/**/*.html",
    "./app/static/js/**/*.js",
    "./app/**/*.py"     // only if you embed class strings in python-rendered html
  ],
  theme: {
    extend: {
      colors: {
        hitachi: { red: "#E60027" }
      }
    }
  },
  safelist: [
    // Classes added only via JS at runtime (Tailwind can’t see them during build)
    "ring-2",
    "ring-white/50",
    "bg-[color:#E60027]",
    "bg-[var(--brand-red)]"
  ]
};
