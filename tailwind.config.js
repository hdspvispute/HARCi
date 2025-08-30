/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/templates/**/*.html",
    "./templates/**/*.html",
    "./app/static/js/**/*.js",
    "./app/**/*.py"
  ],
  theme: {
    extend: {
      colors: { hitachi: { red: "#E60027" } }
    }
  },
  safelist: [
    // Runtime-added
    "ring-2",
    "ring-white/50",
    // Arbitrary values used in templates/CSS
    "z-[9999]",
    "h-[calc(100dvh-4rem)]",
    "h-[calc(100%-80px)]",
    "pb-[calc(env(safe-area-inset-bottom)+.25rem)]",
    "pb-[calc(env(safe-area-inset-bottom)+0.25rem)]",
    "bg-[var(--brand-red)]",
    "bg-[color:#E60027]"
  ],
  plugins: [
    require("@tailwindcss/typography"),
    // require("@tailwindcss/aspect-ratio"), // optional (we added a CSS fallback)
  ],
};
