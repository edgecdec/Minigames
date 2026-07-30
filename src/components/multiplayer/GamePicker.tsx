"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MULTIPLAYER_GAMES } from "@/games/multiplayerRegistry";

/**
 * The host's game menu inside a lobby. Reads the registry, so a new
 * multiplayer game appears here with no change to this file.
 */
export default function GamePicker({
  onSelect,
  playerCount,
  disabled,
  currentSlug,
}: {
  onSelect: (slug: string) => void;
  playerCount: number;
  /** True for non-hosts, who see the list read-only. */
  disabled?: boolean;
  currentSlug?: string | null;
}) {
  return (
    <Stack spacing={1.5} sx={{ width: "100%" }}>
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.75rem",
        }}
      >
        {disabled ? "Host is choosing a game" : "Pick a game"}
      </Typography>

      {MULTIPLAYER_GAMES.map((g) => {
        const notEnough = playerCount < g.minPlayers;
        const wip = g.status === "wip";
        const blocked = disabled || wip || notEnough;
        const selected = currentSlug === g.slug;

        return (
          <Card
            key={g.slug}
            elevation={0}
            sx={{
              borderRadius: 3,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: selected ? "primary.main" : "rgba(124,92,255,0.14)",
              opacity: blocked && !selected ? 0.6 : 1,
            }}
          >
            <CardActionArea
              disabled={blocked}
              onClick={() => onSelect(g.slug)}
              sx={{ p: 2, alignItems: "flex-start" }}
            >
              <Stack direction="row" spacing={2} alignItems="flex-start">
                <Box sx={{ fontSize: "1.75rem", lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
                  {g.icon}
                </Box>
                <Stack spacing={0.5} sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {g.title}
                    </Typography>
                    {wip ? (
                      <Chip label="soon" size="small" sx={{ height: 18, fontSize: "0.6rem" }} />
                    ) : null}
                    {notEnough && !wip ? (
                      <Chip
                        label={`needs ${g.minPlayers}+`}
                        size="small"
                        sx={{ height: 18, fontSize: "0.6rem" }}
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {g.blurb}
                  </Typography>
                </Stack>
              </Stack>
            </CardActionArea>
          </Card>
        );
      })}
    </Stack>
  );
}
