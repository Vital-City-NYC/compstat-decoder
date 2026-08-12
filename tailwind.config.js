module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    // Vital City type stack: Halyard (Typekit) carries the system; Gascogne is the serif exception.
    fontFamily: {
      sans: ['"halyard-text"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
      serif: ['"GascogneTS"', 'Georgia', '"Times New Roman"', 'serif'],
    },
    extend: {},
  },
  plugins: [],
}
