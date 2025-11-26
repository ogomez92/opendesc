import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/read-convert.tsx"),
  route("convert-subtitles", "routes/convert-subtitles.tsx"),
  route("align", "routes/align.tsx"),
  route("subtitle-creation", "routes/subtitle-creation.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
