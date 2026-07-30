"use client";

import Link from "next/link";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MULTIPLAYER_GAMES } from "@/games/multiplayerRegistry";

/**
 * Menu entry for the multiplayer section. Deliberately louder than a game tile
 * — it's a section, not one game, and the count comes from the registry so it
 * stays right as games are added.
 */
export default function MultiplayerCard() {
  const live = MULTIPLAYER_GAMES.filter((g) => g.status === "live").length;

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "primary.main",
        transition: "transform 120ms, box-shadow 120ms",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: "0 8px 28px rgba(124,92,255,0.18)",
        },
      }}
    >
      <CardActionArea component={Link} href="/multiplayer" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <Box sx={{ fontSize: "2rem", lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
            👥
          </Box>
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Multiplayer
              </Typography>
              <Chip
                label={`${live} ${live === 1 ? "game" : "games"}`}
                size="small"
                sx={{
                  height: 18,
                  fontSize: "0.65rem",
                  bgcolor: "rgba(124,92,255,0.18)",
                  color: "#a692ff",
                }}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Create a room, share the code, play together on any device.
            </Typography>
          </Stack>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
