import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import { createClient } from "redis";
import { nanoid } from "nanoid";
import QRCode from "qrcode";
import rateLimit from "express-rate-limit";
import path from "path"; // To serve static files

const app = express();
app.use(express.json());

// Serve the static HTML page
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI!)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// MongoDB Schema and Model
interface IUrl {
  shortId: string;
  longUrl: string;
}

const UrlSchema = new mongoose.Schema<IUrl>({
  shortId: { type: String, required: true, unique: true },
  longUrl: { type: String, required: true },
});
const UrlModel = mongoose.model<IUrl>("Url", UrlSchema);

// Redis Connection
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
});
redisClient.connect().catch((err) => {
  console.error("Redis connection error:", err.message);
  process.exit(1); // Exit process if connection fails
});

// Shorten URL via POST (Postman and Web)
app.post("/shorten", async (req, res) => {
  const { longUrl }: { longUrl: string } = req.body;

  if (!longUrl) {
    return res.status(400).json({ error: "URL required" });
  }

  try {
    const encodedUrl = encodeURIComponent(longUrl);
    const shortId = nanoid(6);
    const shortUrl = `${process.env.BASE_URL}/${shortId}`;

    await UrlModel.create({ shortId, longUrl: encodedUrl });
    await redisClient.setEx(shortId, 3600, encodedUrl); // Cache for 1 hour

    const qrCode = await QRCode.toDataURL(shortUrl);

    // Respond with shortened URL and QR code
    res.json({ shortUrl, qrCode });
  } catch (error) {
    console.error("Error shortening URL:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Redirect to Long URL
app.get("/:shortId", async (req, res) => {
  const { shortId }: { shortId: string } = req.params;

  try {
    let longUrl = await redisClient.get(shortId);
    if (!longUrl) {
      const urlDoc = await UrlModel.findOne({ shortId });
      if (!urlDoc) return res.status(404).json({ error: "URL not found" });

      longUrl = urlDoc.longUrl;
      await redisClient.setEx(shortId, 3600, longUrl);
    }

    longUrl = decodeURIComponent(longUrl);

    // Output the redirected long URL to terminal
    console.log(`Redirected to: ${longUrl}`);

    res.redirect(longUrl);
  } catch (error) {
    console.error("Error during URL redirection:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
