"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

export interface SettingRow<T extends string | number> {
  /** Key in the settings object this row edits. */
  field: string;
  label: string;
  /** Short explanation of what the setting does. */
  hint?: string;
  options: readonly T[];
  value: T;
  /** How to render an option — defaults to String(option). */
  format?: (option: T) => string;
}

/**
 * Host-editable lobby settings, shared by every multiplayer game.
 *
 * Follows the pattern TopTenGame settled on: the host mutates settings, everyone
 * sees them, and the server re-validates every field against its own allow-list
 * — the options here come from the server so this UI can't drift from what is
 * actually accepted.
 *
 * Non-hosts get a read-only view rather than a hidden one, so joiners can see
 * what they're about to play before it starts.
 */
export default function SettingsPanel({
  rows,
  onChange,
  disabled,
  title = "Game settings",
  note,
}: {
  rows: SettingRow<string | number>[];
  onChange: (field: string, value: string | number) => void;
  /** True for non-hosts, and once a game is in progress. */
  disabled?: boolean;
  title?: string;
  note?: string;
}) {
  return (
    <Paper
      elevation={0}
      sx={{ width: "100%", p: 2, borderRadius: 2, bgcolor: "background.paper" }}
    >
      <Typography
        variant="subtitle2"
        sx={{
          fontWeight: 700,
          color: "text.secondary",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.75rem",
          mb: 1.5,
        }}
      >
        ⚙️ {title}
      </Typography>

      <Stack spacing={2}>
        {rows.map((row) => (
          <Box key={row.field}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.25 }}>
              {row.label}
            </Typography>
            {row.hint ? (
              <Typography
                variant="caption"
                sx={{ display: "block", color: "text.secondary", mb: 0.75 }}
              >
                {row.hint}
              </Typography>
            ) : null}
            <ToggleButtonGroup
              value={row.value}
              exclusive
              size="small"
              disabled={disabled}
              onChange={(_, v) => {
                if (v !== null) onChange(row.field, v);
              }}
              sx={{ flexWrap: "wrap" }}
            >
              {row.options.map((opt) => (
                <ToggleButton key={String(opt)} value={opt} sx={{ px: 1.25, fontWeight: 700 }}>
                  {row.format ? row.format(opt) : String(opt)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
        ))}
      </Stack>

      {note ? (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 2, color: "text.secondary" }}
        >
          {note}
        </Typography>
      ) : null}

      {disabled ? (
        <Typography
          variant="caption"
          sx={{ display: "block", mt: 1, color: "text.secondary", fontStyle: "italic" }}
        >
          Only the host can change these.
        </Typography>
      ) : null}
    </Paper>
  );
}
