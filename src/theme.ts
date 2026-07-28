"use client";

import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0f1120", paper: "#171a2e" },
    primary: { main: "#7c5cff" },
    // Accents exist so charts and game visuals have tokens to reach for
    // instead of scattering hex literals through components.
    secondary: { main: "#39d8ff" },
    success: { main: "#3ddc97" },
    warning: { main: "#ffb547" },
    error: { main: "#ff5c7a" },
    text: { primary: "#e6e7f0", secondary: "#8f92aa" },
  },
  typography: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontSize: "2.5rem", fontWeight: 800, letterSpacing: "-0.03em" },
  },
});

export default theme;
