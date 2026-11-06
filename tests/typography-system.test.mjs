import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const walk = (dir, predicate, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, predicate, out);
    else if (predicate(file)) out.push(file);
  }
  return out;
};
const relative = (file) => path.relative(ROOT, file).replaceAll(path.sep, "/");
const scale = {
  "large-title": [64, 80],
  "display-1": [56, 72],
  "display-2": [48, 64],
  "display-3": [40, 54],
  "display-4": [32, 44],
  "title-1": [24, 34],
  "title-2": [20, 26],
  "title-3": [18, 26],
  headline: [16, 22],
  body: [14, 20],
  "body-2": [13, 18],
  "caption-1": [12, 16, 0.15],
  "caption-2": [11, 15, 0.2],
};
const weights = { regular: 400, medium: 500, semibold: 600, bold: 700 };

test("Typography tokens define the exact 13-family scale and four weights", () => {
  const css = read("src/design-system/tokens.css");
  for (const [family, [size, lineHeight, tracking]] of Object.entries(scale)) {
    assert.match(css, new RegExp(`--ds-type-${family}-size:\\s*${size}px;`), family);
    assert.match(css, new RegExp(`--ds-type-${family}-line-height:\\s*${lineHeight}px;`), family);
    if (tracking !== undefined) {
      assert.match(css, new RegExp(`--ds-type-${family}-letter-spacing:\\s*${tracking}px;`), family);
    }
  }
  for (const [name, value] of Object.entries(weights)) {
    assert.match(css, new RegExp(`--ds-font-weight-${name}:\\s*${value};`));
  }
  const families = new Set([...css.matchAll(/--ds-type-([a-z0-9-]+)-size:/g)].map((match) => match[1]));
  assert.deepEqual([...families].sort(), Object.keys(scale).sort());
});

test("All 52 composite classes own a complete type style and never own color", () => {
  const css = read("src/design-system/typography.css");
  let count = 0;
  for (const family of Object.keys(scale)) {
    for (const weight of Object.keys(weights)) {
      const selector = `.text-${family}-${weight}`;
      const match = css.match(new RegExp(`\\${selector}\\s*\\{([^}]+)\\}`));
      assert.ok(match, `${selector} must exist`);
      const body = match[1];
      assert.match(body, /font-family:\s*var\(--ds-font-sans\)/, selector);
      assert.match(body, new RegExp(`font-size:\\s*var\\(--ds-type-${family}-size\\)`), selector);
      assert.match(body, new RegExp(`line-height:\\s*var\\(--ds-type-${family}-line-height\\)`), selector);
      assert.match(body, new RegExp(`font-weight:\\s*var\\(--ds-font-weight-${weight}\\)`), selector);
      if (family.startsWith("caption-")) {
        assert.match(body, new RegExp(`letter-spacing:\\s*var\\(--ds-type-${family}-letter-spacing\\)`), selector);
      }
      assert.doesNotMatch(body, /(?:^|;)\s*(?:color|background(?:-color)?)\s*:/, selector);
      count += 1;
    }
  }
  assert.equal(count, 52);
});

test("cn registers all 52 composites without merging them into text colors", async () => {
  const { transform } = await import("esbuild");
  const compiled = await transform(read("src/lib/cn.ts"), { loader: "ts", format: "esm" });
  const cacheDir = path.join(ROOT, "node_modules", ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const temporary = path.join(cacheDir, `persora-cn-${process.pid}.mjs`);
  fs.writeFileSync(temporary, compiled.code);
  try {
    const { cn } = await import(`${pathToFileURL(temporary).href}?test=${Date.now()}`);
    for (const family of Object.keys(scale)) {
      for (const weight of Object.keys(weights)) {
        const composite = `text-${family}-${weight}`;
        assert.equal(cn(`${composite} text-red-500`), `${composite} text-red-500`, composite);
        assert.equal(cn(`text-red-500 ${composite}`), `text-red-500 ${composite}`, composite);
        assert.equal(cn(`${composite} text-sm`), "text-sm", composite);
      }
    }
    assert.equal(cn("text-body-regular text-title-2-semibold"), "text-title-2-semibold");
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  assert.match(read("src/lib/utils.ts"), /export \{ cn \} from "\.\/cn"/);
  const directImports = walk(path.join(ROOT, "src"), (name) => /\.tsx?$/.test(name))
    .filter((file) => /from ["']cn["']/.test(fs.readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(directImports, [], "Use the configured @/lib/cn or @/lib/utils export");
});

test("Self-hosted Geist Sans and Geist Mono share one design-system import chain", () => {
  const fonts = read("src/design-system/fonts.css");
  const tokens = read("src/design-system/tokens.css");
  const main = read("src/main.tsx");
  const pkg = JSON.parse(read("package.json"));
  assert.match(fonts, /@import "@fontsource-variable\/geist";/);
  assert.match(fonts, /@import "@fontsource-variable\/geist-mono";/);
  assert.match(tokens, /--ds-font-mono:\s*"Geist Mono Variable", "Geist Mono"/);
  assert.ok(pkg.dependencies["@fontsource-variable/geist"]);
  assert.ok(pkg.dependencies["@fontsource-variable/geist-mono"]);
  assert.ok(main.indexOf('import "./design-system/system.css"') < main.indexOf('import "./design-system/typography.css"'));
  assert.match(read("src/index.css"), /--font-mono:\s*var\(--ds-font-mono\)/);
  assert.match(read("src/components/SearchModal.tsx"), /<kbd className="[^"]*font-mono/);
});

test("Interface CSS has no off-scale numeric sizes, weights, tracking, or unpaired type tokens", () => {
  const offenders = [];
  const intentional = /\.(?:tb|pd|pf)-mini|rich-note-(?:content|rendered)|emoji|glyph|file-type|pd-prosemirror/i;
  for (const file of walk(path.join(ROOT, "src"), (name) => name.endsWith(".css"))) {
    const rel = relative(file);
    if (/design-system\/(?:tokens|typography)\.css$/.test(rel)) continue;
    const css = fs.readFileSync(file, "utf8");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1];
      const body = rule[2];
      if (intentional.test(selector)) continue;
      for (const match of body.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem)\b/g)) {
        offenders.push(`${rel}: ${selector.trim()} -> font-size ${match[1]}${match[2]}`);
      }
      for (const match of body.matchAll(/font-weight\s*:\s*(\d+)\b/g)) {
        if (![400, 500, 600, 700].includes(Number(match[1]))) offenders.push(`${rel}: ${selector.trim()} -> weight ${match[1]}`);
      }
      for (const match of body.matchAll(/letter-spacing\s*:\s*([^;}]+)/g)) {
        const value = match[1].trim();
        if (!/^(?:normal|inherit|var\()/.test(value)) offenders.push(`${rel}: ${selector.trim()} -> tracking ${value}`);
      }
      if (!/clamp\(/.test(body)) {
        for (const match of body.matchAll(/font-size\s*:\s*var\(--ds-type-([a-z0-9-]+)-size\)/g)) {
          const family = match[1];
          if (!new RegExp(`line-height\\s*:\\s*var\\(--ds-type-${family}-line-height\\)`).test(body)) {
            offenders.push(`${rel}: ${selector.trim()} -> ${family} size lacks its matching line height`);
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("TSX utilities use semantic type tokens instead of legacy numeric size classes", () => {
  const offenders = [];
  for (const file of walk(path.join(ROOT, "src"), (name) => name.endsWith(".tsx"))) {
    const rel = relative(file);
    if (rel.endsWith("components/reui/file-type.tsx")) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/text-\[\d+(?:\.\d+)?(?:px|rem)\]|(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-7]xl)(?![\w-])|tracking-(?:tighter|tight|wide|wider|widest)|leading-(?:tight|snug|normal|relaxed|loose)/g)) {
      offenders.push(`${rel}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
