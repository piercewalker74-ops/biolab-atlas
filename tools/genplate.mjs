// Atmosphere-plate generator for the Atlas beauty study (gpt-image-1).
// Usage: node tools/genplate.mjs <slug> <size> "<prompt>"
import fs from "node:fs";
import path from "node:path";

const [, , slug, size, ...rest] = process.argv;
const prompt = rest.join(" ");
const key = process.env.OPENAI_API_KEY;
if (!key) { console.error("no OPENAI_API_KEY"); process.exit(1); }
if (!slug || !prompt) { console.error('usage: genplate <slug> <size> "<prompt>"'); process.exit(1); }

const body = {
  model: "gpt-image-1",
  prompt,
  size: size || "1536x1024",
  n: 1,
  quality: "high",
  background: "opaque",
};

const t0 = Date.now();
const res = await fetch("https://api.openai.com/v1/images/generations", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
  body: JSON.stringify(body),
});
const ms = Date.now() - t0;
if (!res.ok) {
  console.error("HTTP", res.status, (await res.text()).slice(0, 600));
  process.exit(2);
}
const j = await res.json();
const b64 = j.data?.[0]?.b64_json;
if (!b64) { console.error("no image in response", JSON.stringify(j).slice(0, 400)); process.exit(3); }
const dir = path.resolve("assets");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `${slug}.png`);
fs.writeFileSync(out, Buffer.from(b64, "base64"));
console.log("OK", out, fs.statSync(out).size, "bytes", ms + "ms");
