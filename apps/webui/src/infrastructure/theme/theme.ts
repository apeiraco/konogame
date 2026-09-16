import { createTheme, type MantineColorsTuple } from "@mantine/core";

// Vermilion seal ink: the single brand accent for primary actions and active navigation.
const shu: MantineColorsTuple = [
  "#fdf0ec",
  "#f8dcd3",
  "#efb5a5",
  "#e68b74",
  "#de6a4d",
  "#d55536",
  "#c8442b",
  "#a83722",
  "#8a2d1c",
  "#6b2214"
];

// Warm paper-to-ink neutrals; Mantine's dark scale drives surfaces in the dark scheme.
const sumi: MantineColorsTuple = [
  "#ece6da",
  "#cfc7b8",
  "#a39b8c",
  "#7d766a",
  "#4a453d",
  "#34302a",
  "#24211d",
  "#1c1a17",
  "#161412",
  "#100f0d"
];

/** Fonts are local system stacks so the product shell stays usable offline. */
export const webuiTheme = createTheme({
  primaryColor: "shu",
  primaryShade: { light: 6, dark: 5 },
  colors: { shu, dark: sumi },
  black: "#1d1b18",
  white: "#fbfaf6",
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  fontFamilyMonospace:
    'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily:
      '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", "Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "STSong", serif',
    fontWeight: "600"
  },
  defaultRadius: "sm",
  radius: { xs: "2px", sm: "4px", md: "6px", lg: "10px", xl: "16px" },
  focusRing: "auto",
  cursorType: "pointer",
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { radius: "sm" } },
    Modal: { defaultProps: { radius: "md", overlayProps: { backgroundOpacity: 0.45, blur: 2 } } },
    Popover: { defaultProps: { radius: "md", shadow: "lg" } }
  }
});
