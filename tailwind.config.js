/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17221d",
        leaf: "#16734a",
        "leaf-dark": "#105a39",
        cream: "#f5f7f2",
        gold: "#f3bd47"
      },
      boxShadow: {
        card: "0 3px 18px rgba(23, 34, 29, 0.06)"
      }
    }
  },
  plugins: []
};
