import express from "express";
import fetch from "node-fetch";
import { LRUCache } from "lru-cache";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const pins = [];
const MAX_PINS = 300;

app.get("/ping", (req, res) => res.send("pong"));

const geoCache = new LRUCache({ max: 1000, ttl: 1000 * 60 * 60 * 24 * 7 });
const userCooldown = new LRUCache({ max: 5000, ttl: 1000 * 30 });
const ipCooldown = new LRUCache({ max: 10000, ttl: 1000 * 5 });

function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, 80);
}
function safeUser(u) {
  return String(u || "viewer").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 25) || "viewer";
}

async function geocodeNominatim(query) {
  const q = cleanText(query);
  if (!q) return null;

  const cached = geoCache.get(q.toLowerCase());
  if (cached) return cached;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "KoalaBaitsCheckIn/1.0 (contact: ReportToKoala@gmail.com)"
    }
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  const hit = data[0];
  const result = {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    displayName: hit.display_name || q
  };
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) return null;

  geoCache.set(q.toLowerCase(), result);
  return result;
}

app.get("/checkin", async (req, res) => {
  try {
    const u = safeUser(req.query.u);
    const loc = cleanText(req.query.loc);

    if (!loc) return res.send("no location");

    // TEMP: hard-coded Adelaide to prove pipeline works
    const pin = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      user: u,
      display: "Adelaide, South Australia, Australia",
      lat: -34.9285,
      lon: 138.6007,
      ts: Date.now()
    };

    pins.unshift(pin);
    res.send("ok");
  } catch (e) {
    console.error("CHECKIN_ERROR", e);
    res.status(500).send(e?.message || String(e));
  }
});


app.get("/pins", (req, res) => {
  const n = Math.min(Number(req.query.n || 80), 200);
  res.json(pins.slice(0, n));
});

app.listen(PORT, () => console.log("running on", PORT));
