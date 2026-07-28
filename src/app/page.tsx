import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

export default function Home() {
  return (
    <Container maxWidth="md">
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          gap: 2,
        }}
      >
        <Typography variant="h1" component="h1">
          Minigames
        </Typography>
        <Typography variant="body1" color="text.secondary">
          A collection of small browser minigames. Nothing here yet.
        </Typography>
      </Box>
    </Container>
  );
}
