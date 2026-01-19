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

async function geocode(query) {
  const q = cleanText(query);
  if (!q) return null;

  const cached = geoCache.get(q.toLowerCase());
  if (cached) return cached;

  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Photon ${res.status}`);

  const data = await res.json();
  if (!data.features || !data.features.length) return null;

  const f = data.features[0];
  const result = {
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    displayName: [
      f.properties.name,
      f.properties.state,
      f.properties.country
    ].filter(Boolean).join(", ")
  };

  geoCache.set(q.toLowerCase(), result);
  return result;
}


app.get("/checkin", async (req, res) => {
  try {
    const u = safeUser(req.query.u);
    const loc = cleanText(req.query.loc);

    if (!loc) return res.send("no location");

const geo = await geocode(loc);
if (!geo) return res.send("not found");

// one pin per user: remove old pin if it exists
const existingIndex = pins.findIndex(p => p.user === u);
if (existingIndex !== -1) {
  pins.splice(existingIndex, 1);
}

pins.unshift({
  id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
  user: u,
  display: geo.displayName,
  lat: geo.lat,
  lon: geo.lon,
  ts: Date.now()
});


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
