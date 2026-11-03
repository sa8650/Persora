import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("AudioSpace player is scoped to AudioSpaceView and obsolete global .as-player-main is removed", () => {
  const workspace = read("src/components/Workspace.tsx");
  const audioSpaceView = read("src/components/audio-space/AudioSpaceView.tsx");
  const playerBar = read("src/components/audio-space/AudioPlayerBar.tsx");
  const audioCss = read("src/components/audio-space/audio-space.css");

  // Single centralized playback engine remains in Workspace.tsx
  assert.match(workspace, /const audioPlayer = useAudioPlayer\(\)/);

  // Global AudioPlayerBar render is gone from Workspace.tsx; AudioSpaceView owns it
  assert.doesNotMatch(workspace, /<AudioPlayerBar\b/);
  assert.match(audioSpaceView, /<AudioPlayerBar\s+player=\{player\}\s*\/>/);

  // Obsolete oversized full-width toolbar classes are completely removed
  assert.doesNotMatch(playerBar, /as-player-main/);
  assert.doesNotMatch(audioCss, /\.as-player-main\b/);
  assert.doesNotMatch(audioCss, /\.as-player\s*\{/);

  // Minimal collapsible glass player classes exist with compact, collapsed, and expanded modes
  assert.match(playerBar, /as-mini-player/);
  assert.match(audioCss, /\.as-mini-player\b/);
  assert.match(audioCss, /\.as-mini-player\.is-collapsed\b/);
  assert.match(audioCss, /\.as-mini-player\.is-expanded\b/);
});

test("Dynamic Island integrates Now Playing without auto-expanding on navigation or duplicating engines", () => {
  const workspace = read("src/components/Workspace.tsx");
  const island = read("src/components/dynamic-island/DynamicIsland.tsx");
  const islandCss = read("src/components/dynamic-island/dynamic-island.css");

  // Navigation still collapses the island rather than auto-expanding it
  assert.match(workspace, /const updateView[\s\S]*?setIslandOpen\(false\)/);

  // Island Now Playing is active only when outside AudioSpace and a track is loaded
  assert.match(workspace, /const isAudioSpaceActive = view === "audio-space" && !notePage/);
  assert.match(workspace, /const islandMediaActive = !isAudioSpaceActive && audioPlayer\.current !== null/);
  assert.match(workspace, /const islandMediaPlaying = islandMediaActive && audioPlayer\.playing/);

  // Collapsed face preserves PersoraMark first, shows equalizer only when actively playing, and keeps notification dot
  assert.match(
    workspace,
    /<span className="island-mark"><PersoraMark size=\{22\}\/><\/span>\{islandMediaPlaying && <AudioEqualizer playing variant="island-face" className="island-face-eq" \/>\}\{unreadNotificationCount > 0 && <span className="island-face-dot"/,
  );

  // Expanded panel renders IslandNowPlaying alongside the existing .island-actions row
  assert.match(workspace, /\{islandMediaActive && \(\s*<IslandNowPlaying/);
  assert.match(workspace, /<div className="island-actions">/);

  // Base pill stays border-radius: 999px; expanded media card rounds smoothly to 20px
  assert.match(islandCss, /\.island-shell\s*\{[^}]*border-radius:\s*999px/);
  assert.match(islandCss, /\.island-shell\.is-open\.has-media\s*\{[^}]*border-radius:\s*20px/);

  // Range sliders inside expanded island do not trigger horizontal island drag or arrow-key focus hijack
  assert.match(island, /HTMLInputElement/);
  assert.match(island, /\[role='slider'\]/);
});

test("Equalizer animation uses GPU scaleY transforms and pauses cleanly when audio is paused", () => {
  const audioCss = read("src/components/audio-space/audio-space.css");

  assert.match(audioCss, /\.as-audio-eq\.is-playing \.as-eq-bar\s*\{\s*animation-play-state:\s*running/);
  assert.match(audioCss, /\.as-audio-eq\.is-paused \.as-eq-bar\s*\{[\s\S]*?animation:\s*none/);
  assert.match(audioCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.as-eq-bar/);
});
