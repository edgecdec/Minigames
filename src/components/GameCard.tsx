"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { GameMeta } from "@/games/registry";

export default function GameCard({ game }: { game: GameMeta }) {
  const wip = game.status === "wip";

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "rgba(124,92,255,0.14)",
        transition: "border-color 120ms, transform 120ms",
        "&:hover": wip
          ? {}
          : { borderColor: "primary.main", transform: "translateY(-2px)" },
      }}
    >
      <CardActionArea
        component={wip ? "div" : Link}
        href={wip ? undefined : `/${game.slug}`}
        disabled={wip}
        sx={{ p: 2.5, height: "100%", alignItems: "flex-start" }}
      >
        <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ width: "100%" }}>
          <Box
            sx={{
              fontSize: "2rem",
              lineHeight: 1,
              flexShrink: 0,
              filter: wip ? "grayscale(1)" : "none",
              opacity: wip ? 0.5 : 1,
            }}
            aria-hidden="true"
          >
            {game.icon}
          </Box>
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {game.title}
              </Typography>
              {wip ? (
                <Chip
                  label="Soon"
                  size="small"
                  sx={{ height: 18, fontSize: "0.65rem", bgcolor: "rgba(255,255,255,0.08)" }}
                />
              ) : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {game.blurb}
            </Typography>
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
