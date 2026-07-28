"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

/**
 * Common chrome for every game: back link, title, controls hint, and a
 * centered slot for the game itself. Keeps games from re-inventing layout.
 */
export default function GameShell({
  title,
  icon,
  controls,
  children,
  footer,
  maxWidth = "sm",
}: {
  title: string;
  icon: string;
  controls: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Widen for games that need room — a board, a chart grid. Default "sm". */
  maxWidth?: "xs" | "sm" | "md" | "lg";
}) {
  return (
    <Container maxWidth={maxWidth}>
      <Box sx={{ minHeight: "100vh", py: 3, display: "flex", flexDirection: "column" }}>
        <Button
          component={Link}
          href="/"
          startIcon={<ArrowBackIcon />}
          sx={{ alignSelf: "flex-start", mb: 2, color: "text.secondary" }}
        >
          All games
        </Button>

        <Stack spacing={0.5} sx={{ textAlign: "center", mb: 3 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
            <span aria-hidden="true">{icon}</span> {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {controls}
          </Typography>
        </Stack>

        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: 2,
          }}
        >
          {children}
        </Box>

        {footer ? <Box sx={{ mt: 3, textAlign: "center" }}>{footer}</Box> : null}
      </Box>
    </Container>
  );
}
