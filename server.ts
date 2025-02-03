import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import { createClient } from "redis";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import path from "path"; // To serve static files

const app = express();
app.use(express.json());

// Serve the static HTML page
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI!, {
  // No need to specify `useNewUrlParser` and `useUnifiedTopology`
  // These options are now default in the latest Mongoose version.
}).then(() => {
  console.log("MongoDB connected");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

const UrlSchema = new mongoose.Schema({
  shortId: String,
  longUrl: String,
});
const UrlModel = mongoose.model("Url", UrlSchema);

// Redis Connection
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
});
redisClient.connect();

// Shorten URL via POST (Postman and Web)
app.post("/shorten", async (req, res) => {
  const { longUrl } = req.body;
  if (!longUrl) return res.status(400).json({ error: "URL required" });

  const shortId = nanoid(6);
  const shortUrl = `${process.env.BASE_URL}/${shortId}`;

  await UrlModel.create({ shortId, longUrl });
  await redisClient.setEx(shortId, 3600, longUrl); // Cache for 1 hour

  const qrCode = await QRCode.toDataURL(shortUrl);

  // Respond with shortened URL and QR code
  res.json({ shortUrl, qrCode });
});

// Redirect to Long URL
app.get("/:shortId", async (req, res) => {
  const { shortId } = req.params;

  let longUrl = await redisClient.get(shortId);
  if (!longUrl) {
    const urlDoc = await UrlModel.findOne({ shortId });
    if (!urlDoc) return res.status(404).json({ error: "URL not found" });

    longUrl = urlDoc.longUrl;
    await redisClient.setEx(shortId, 3600, longUrl);
  }

  res.redirect(longUrl);
});

app.listen(3000, () => console.log("Server running on port 3000"));
