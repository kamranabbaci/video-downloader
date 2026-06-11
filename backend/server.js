const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 5000;

app.use(cors({ origin: "http://192.168.100.8:4200" }));
app.use(express.json({ limit: "2mb" }));

const downloadsDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

function isAllowedUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("youtube.com") ||
      host.includes("youtu.be") ||
      host.includes("tiktok.com") ||
      host.includes("facebook.com") ||
      host.includes("fb.watch") ||
      host.includes("instagram.com")
    );
  } catch {
    return false;
  }
}

function getPlatform(url) {
  const host = new URL(url).hostname.toLowerCase();

  if (host.includes("youtube.com") || host.includes("youtu.be"))
    return "youtube";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("facebook.com") || host.includes("fb.watch"))
    return "facebook";
  if (host.includes("instagram.com")) return "instagram";

  return "unknown";
}

function cleanYoutubeUrl(url) {
  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) {
      const videoId = u.pathname.replace("/", "");
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    if (u.hostname.includes("youtube.com") && u.searchParams.has("v")) {
      return `https://www.youtube.com/watch?v=${u.searchParams.get("v")}`;
    }

    return url;
  } catch {
    return url;
  }
}

function sanitizeFileName(name) {
  return String(name || "video")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function formatSize(bytes) {
  if (!bytes) return null;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", args, { windowsHide: true });

    let stdout = "";
    let stderr = "";

    ytdlp.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ytdlp.on("error", reject);

    ytdlp.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "yt-dlp failed."));
      } else {
        resolve(stdout);
      }
    });
  });
}

function getCommonArgs() {
  return ["--no-playlist", "--no-warnings"];
}

function getYoutubeArgs() {
  return [
    "--no-playlist",
    "--no-warnings",
  ];
}

async function getMediaInfo(url, platform) {
  const args =
    platform === "youtube"
      ? [...getYoutubeArgs(), "--dump-single-json", url]
      : [...getCommonArgs(), "--dump-single-json", url];

  const output = await runYtDlp(args);
  return JSON.parse(output);
}

/* ===================== TikWM TikTok API ===================== */

function normalizeTikwmUrl(url) {
  if (!url) return null;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return "https://www.tikwm.com" + url;
  return url;
}

async function fetchTikwmInfo(videoUrl) {
  const body = new URLSearchParams();
  body.append("url", videoUrl);
  body.append("hd", "1");

  const response = await fetch("https://www.tikwm.com/api/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("TikWM API request failed.");
  }

  const json = await response.json();

  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || "TikWM could not extract this TikTok video.");
  }

  return json.data;
}

function buildTikwmFormats(data) {
  const formats = [];
  const usedUrls = new Set();

  const addFormat = (formatId, label, videoUrl, size) => {
    const finalUrl = normalizeTikwmUrl(videoUrl);
    if (!finalUrl || usedUrls.has(finalUrl)) return;

    usedUrls.add(finalUrl);

    formats.push({
      formatId,
      ext: "mp4",
      height: 0,
      resolution: label,
      filesize: size || null,
      filesizeText: size ? formatSize(size) : null,
      label: `${label} MP4${size ? " • " + formatSize(size) : ""}`,
      mode: "direct",
    });
  };

  addFormat("tikwm_hd", "HD Quality", data.hdplay, data.hd_size);
  addFormat("tikwm_nowm", "No Watermark", data.play, data.size);
  addFormat("tikwm_wm", "With Watermark", data.wmplay, data.wm_size);

  return formats;
}

function getTikwmDownloadUrl(data, formatId) {
  if (formatId === "tikwm_hd") return normalizeTikwmUrl(data.hdplay);
  if (formatId === "tikwm_nowm") return normalizeTikwmUrl(data.play);
  if (formatId === "tikwm_wm") return normalizeTikwmUrl(data.wmplay);
  return null;
}

/* ===================== Format Builders ===================== */

function buildYoutubeFormats(info) {
  const allFormats = info.formats || [];
  const formats = [];

  const audio =
    allFormats.find((f) => String(f.format_id) === "140") ||
    allFormats.find(
      (f) =>
        f.ext === "m4a" &&
        f.acodec &&
        f.acodec !== "none" &&
        (!f.vcodec || f.vcodec === "none")
    );

  const targets = [
    { height: 360, directId: "18" },
    { height: 480 },
    { height: 720 },
    { height: 1080 },
  ];

  for (const target of targets) {
    let formatId = null;
    let size = null;

    if (target.directId) {
      const direct = allFormats.find(
        (f) => String(f.format_id) === target.directId
      );

      if (direct) {
        formatId = String(direct.format_id);
        size = direct.filesize || direct.filesize_approx || null;
      }
    }

    if (!formatId && audio) {
      const video = allFormats.find(
        (f) =>
          Number(f.height) === target.height &&
          f.ext === "mp4" &&
          f.vcodec &&
          f.vcodec !== "none" &&
          (!f.acodec || f.acodec === "none")
      );

      if (video) {
        const videoSize = video.filesize || video.filesize_approx || 0;
        const audioSize = audio.filesize || audio.filesize_approx || 0;

        formatId = `${video.format_id}+${audio.format_id}`;
        size = videoSize + audioSize || null;
      }
    }

    if (!formatId) continue;

    formats.push({
      formatId,
      ext: "mp4",
      height: target.height,
      resolution: `${target.height}p`,
      filesize: size,
      filesizeText: size ? formatSize(size) : "Unknown size",
      label: `${target.height}p MP4${size ? " • " + formatSize(size) : ""}`,
      mode: "process",
    });
  }

  console.log("FINAL YOUTUBE FORMATS:", formats);
  return formats;
}

function buildSocialFormats(info) {
  const allFormats = info.formats || [];

  let directFormats = allFormats
    .filter(
      (f) =>
        f.format_id &&
        f.ext === "mp4" &&
        f.acodec !== "none" &&
        f.vcodec !== "none",
    )
    .map((f) => {
      const size = Number(f.filesize || f.filesize_approx || 0);

      return {
        formatId: String(f.format_id),
        ext: "mp4",
        height: f.height || 0,
        width: f.width || 0,
        filesize: size,
        filesizeText: size ? formatSize(size) : null,
        tbr: f.tbr || 0,
        mode: "direct",
      };
    })
    .sort((a, b) => {
      if (b.filesize !== a.filesize) return b.filesize - a.filesize;
      return (b.tbr || 0) - (a.tbr || 0);
    })
    .slice(0, 5);

  directFormats = directFormats.map((f, index) => {
    const qualityName =
      index === 0
        ? "High Quality"
        : index === 1
          ? "Standard Quality"
          : `Option ${index + 1}`;

    return {
      formatId: f.formatId,
      ext: f.ext,
      height: f.height,
      resolution: qualityName,
      filesize: f.filesize || null,
      filesizeText: f.filesizeText,
      label: `${qualityName} MP4${f.filesizeText ? " • " + f.filesizeText : ""}`,
      mode: f.mode,
    };
  });

  if (directFormats.length > 0) return directFormats;

  return [
    {
      formatId: "best[ext=mp4]/best",
      ext: "mp4",
      height: 0,
      resolution: "Best",
      filesize: null,
      filesizeText: null,
      label: "Best Available MP4",
      mode: "process",
    },
  ];
}

function buildFormats(info, platform) {
  if (platform === "youtube") return buildYoutubeFormats(info);
  if (platform === "facebook" || platform === "instagram") {
    return buildSocialFormats(info);
  }
  return [];
}

/* ===================== Download Helpers ===================== */

async function getDirectMediaUrl(url, formatId, platform) {
  const args =
    platform === "youtube"
      ? [...getYoutubeArgs(), "-f", String(formatId), "--get-url", url]
      : [...getCommonArgs(), "-f", String(formatId), "--get-url", url];

  const output = await runYtDlp(args);

  const directUrl = output
    .trim()
    .split("\n")
    .find((line) => line.startsWith("http"));

  if (!directUrl) {
    throw new Error(`Could not extract direct ${platform} media URL.`);
  }

  return directUrl;
}

function proxyDownload(directUrl, res, fileName) {
  const parsedUrl = new URL(directUrl);
  const client = parsedUrl.protocol === "https:" ? https : http;

  const request = client.get(
    directUrl,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: "*/*",
      },
    },
    (upstream) => {
      if (
        upstream.statusCode >= 300 &&
        upstream.statusCode < 400 &&
        upstream.headers.location
      ) {
        const redirectUrl = new URL(
          upstream.headers.location,
          directUrl,
        ).toString();
        return proxyDownload(redirectUrl, res, fileName);
      }

      if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
        if (!res.headersSent) {
          res
            .status(500)
            .send(
              `Unable to download media stream. Upstream status: ${upstream.statusCode}`,
            );
        }
        return;
      }

      res.setHeader(
        "Content-Type",
        upstream.headers["content-type"] || "video/mp4",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );

      if (upstream.headers["content-length"]) {
        res.setHeader("Content-Length", upstream.headers["content-length"]);
      }

      upstream.pipe(res);
    },
  );

  request.on("error", (error) => {
    if (!res.headersSent) {
      res.status(500).send("Proxy download failed: " + error.message);
    }
  });

  res.on("close", () => {
    request.destroy();
  });
}

function downloadToTempFile(url, formatId, outputPath) {
  return new Promise((resolve, reject) => {
    const platform = getPlatform(url);

    const args =
      platform === "youtube"
        ? [
            ...getYoutubeArgs(),
            "-f",
            String(formatId),
            "--merge-output-format",
            "mp4",
            "-o",
            outputPath,
            url,
          ]
        : [
            ...getCommonArgs(),
            "-f",
            String(formatId),
            "--merge-output-format",
            "mp4",
            "-o",
            outputPath,
            url,
          ];

    const ytdlp = spawn("yt-dlp", args, { windowsHide: true });

    let stderr = "";

    ytdlp.stderr.on("data", (data) => {
      stderr += data.toString();
      console.log(data.toString());
    });

    ytdlp.on("error", reject);

    ytdlp.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || "yt-dlp download failed."));
      } else {
        resolve();
      }
    });
  });
}

function sendAndDeleteFile(res, filePath, downloadName) {
  if (!fs.existsSync(filePath)) {
    return res.status(500).send("Downloaded file not found.");
  }

  const stats = fs.statSync(filePath);

  if (stats.size === 0) {
    fs.unlinkSync(filePath);
    return res.status(500).send("Downloaded file is empty.");
  }

  res.download(filePath, downloadName, (error) => {
    fs.unlink(filePath, (unlinkError) => {
      if (unlinkError) {
        console.error("Failed to delete temp file:", unlinkError.message);
      }
    });

    if (error) {
      console.error("Download response error:", error.message);
    }
  });
}

/* ===================== Routes ===================== */

app.get("/", (req, res) => {
  res.json({
    message: "Video downloader backend is running.",
  });
});

app.post("/api/info", async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ message: "Video URL is required." });
  }

  if (!isAllowedUrl(url)) {
    return res.status(400).json({
      message:
        "Only YouTube, TikTok, Facebook, and Instagram URLs are allowed.",
    });
  }

  try {
    const platform = getPlatform(url);

    if (platform === "youtube") {
      url = cleanYoutubeUrl(url);
    }

    if (platform === "tiktok") {
      const data = await fetchTikwmInfo(url);
      const formats = buildTikwmFormats(data);

      return res.json({
        title: data.title || "TikTok Video",
        duration: data.duration || null,
        uploader: data.author?.nickname || data.author?.unique_id || "TikTok",
        thumbnail: normalizeTikwmUrl(data.cover) || "",
        webpage_url: url,
        platform,
        formats,
      });
    }

    const info = await getMediaInfo(url, platform);
    const formats = buildFormats(info, platform);

    return res.json({
      title: info.title || "Untitled Video",
      duration: info.duration || null,
      uploader: info.uploader || info.channel || platform,
      thumbnail: info.thumbnail || "",
      webpage_url: info.webpage_url || url,
      platform,
      formats,
    });
  } catch (error) {
    console.error("INFO ERROR:", error.message);

    return res.status(500).json({
      message: "Failed to fetch video information.",
      error: error.message,
    });
  }
});

app.get("/api/stream-download", async (req, res) => {
  let { url, formatId, title } = req.query;

  if (!url || !formatId) {
    return res.status(400).send("Missing video URL or format.");
  }

  if (!isAllowedUrl(String(url))) {
    return res.status(400).send("Unsupported URL.");
  }

  try {
    const platform = getPlatform(String(url));

    if (platform === "youtube") {
      url = cleanYoutubeUrl(String(url));
    }

    if (platform === "tiktok") {
      const data = await fetchTikwmInfo(String(url));
      const directUrl = getTikwmDownloadUrl(data, String(formatId));

      if (!directUrl) {
        return res.status(400).send("Selected TikTok format is not available.");
      }

      const fileName = `${sanitizeFileName(title || data.title || "tiktok-video")}.mp4`;
      return proxyDownload(directUrl, res, fileName);
    }

    const directUrl = await getDirectMediaUrl(
      String(url),
      String(formatId),
      platform,
    );
    const fileName = `${sanitizeFileName(title || "video")}.mp4`;

    return proxyDownload(directUrl, res, fileName);
  } catch (error) {
    console.error("STREAM DOWNLOAD ERROR:", error.message);
    return res.status(500).send("Direct download failed: " + error.message);
  }
});

app.get("/api/process-download", async (req, res) => {
  let { url, formatId, title } = req.query;

  if (!url || !formatId) {
    return res.status(400).send("Missing video URL or format.");
  }

  if (!isAllowedUrl(String(url))) {
    return res.status(400).send("Unsupported URL.");
  }

  try {
    const platform = getPlatform(String(url));

    if (platform === "youtube") {
      url = cleanYoutubeUrl(String(url));
    }

    if (platform === "tiktok") {
      const data = await fetchTikwmInfo(String(url));
      const directUrl = getTikwmDownloadUrl(data, String(formatId));

      if (!directUrl) {
        return res.status(400).send("Selected TikTok format is not available.");
      }

      const fileName = `${sanitizeFileName(title || data.title || "tiktok-video")}.mp4`;
      return proxyDownload(directUrl, res, fileName);
    }

    const id = crypto.randomUUID();
    const tempFile = path.join(downloadsDir, `${id}.mp4`);
    const downloadName = `${sanitizeFileName(title || "video")}.mp4`;

    await downloadToTempFile(String(url), String(formatId), tempFile);

    return sendAndDeleteFile(res, tempFile, downloadName);
  } catch (error) {
    console.error("PROCESS DOWNLOAD ERROR:", error.message);
    return res.status(500).send("Processing download failed: " + error.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
