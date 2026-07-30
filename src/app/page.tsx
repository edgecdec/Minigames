import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import GameCard from "@/components/GameCard";
import MultiplayerCard from "@/components/MultiplayerCard";
import { GAMES } from "@/games/registry";

export default function Home() {
  return (
    <Container maxWidth="sm">
      <Box sx={{ minHeight: "100vh", py: 6 }}>
        <Stack spacing={1} sx={{ textAlign: "center", mb: 5 }}>
          <Typography variant="h1" component="h1" sx={{ fontSize: "2.5rem" }}>
            Minigames
          </Typography>
          <Typography variant="body1" color="text.secondary">
            A collection of small browser games. No accounts, no ads.
          </Typography>
        </Stack>

        <Stack spacing={2} sx={{ mb: 4 }}>
          <MultiplayerCard />
        </Stack>

        <Typography
          variant="subtitle2"
          sx={{
            color: "text.secondary",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: "0.75rem",
            fontWeight: 700,
            mb: 1.5,
          }}
        >
          Solo
        </Typography>

        <Stack spacing={2}>
          {GAMES.map((game) => (
            <GameCard key={game.slug} game={game} />
          ))}
        </Stack>
      </Box>
    </Container>
  );
}
