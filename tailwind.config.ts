import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0A0A0A",
          mid: "#3D3D3D",
          faint: "#888888",
        },
        brand: {
          black: "#0A0A0A",
          "black-mid": "#1A1A1A",
          "black-soft": "#2C2C2C",
          yellow: "#FFC107",
          "yellow-dark": "#E6A800",
          "yellow-light": "#FFD54F",
          "yellow-pale": "#FFF8E1",
          "yellow-50": "#FFFDE7",
        },
        surface: {
          DEFAULT: "#FAFAFA",
          white: "#FFFFFF",
          "gray-100": "#F5F5F5",
          "gray-200": "#EEEEEE",
          "gray-300": "#E0E0E0",
          "gray-400": "#BDBDBD",
        },
        border: {
          DEFAULT: "#E0E0E0",
          dark: "#C8C8C8",
        },
      },
      fontFamily: {
        // Body / data → Lato; headings (via font-display) → Poppins.
        sans: ["'Lato'", "system-ui", "sans-serif"],
        display: ["'Poppins'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "10px",
        lg: "16px",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
