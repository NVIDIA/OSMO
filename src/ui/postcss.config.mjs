// PostCSS configuration with Tailwind v4 and production optimizations
// See: https://tailwindcss.com/docs/optimizing-for-production
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Add cssnano for CSS minification in production
    // Next.js also handles minification, but cssnano provides additional optimizations
    ...(process.env.NODE_ENV === "production" ? { cssnano: { preset: "default" } } : {}),
  },
};

export default config;
