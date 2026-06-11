# Video Downloader

A modern web-based video downloader built with **Angular** and **Node.js**, allowing users to download videos, audio, thumbnails, and metadata from multiple popular platforms through a simple and responsive interface.

## Features

### Supported Platforms

* YouTube
* TikTok
* Facebook
* Instagram
* Other platforms supported through yt-dlp

### Download Options

* Video Download (MP4)
* Audio Download (MP3)
* Multiple Quality Selection
* Thumbnail Download
* Video Metadata Retrieval
* Format Selection Before Download

### User Interface

* Modern Angular UI
* Mobile Responsive Design
* Download Progress Indicators
* Video Preview Modal
* Search and Download Interface
* Fast and Lightweight Experience

### Backend Features

* Node.js + Express API
* yt-dlp Integration
* FFmpeg Processing
* Audio Extraction
* Format Conversion
* Error Handling and Validation

---

## Technology Stack

### Frontend

* Angular
* TypeScript
* HTML5
* SCSS/CSS

### Backend

* Node.js
* Express.js
* yt-dlp
* FFmpeg

---

## Project Structure

```text
video-downloader/
│
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── routes/
│   ├── downloads/
│   └── ...
│
├── frontend/
│   ├── src/
│   ├── angular.json
│   ├── package.json
│   └── ...
│
├── .gitignore
└── README.md
```

---

## Requirements

Before running the project, install:

* Node.js (Latest LTS Recommended)
* Angular CLI
* FFmpeg
* yt-dlp

---

## API Overview

### Get Video Information

```http
POST /api/info
```

### Download Video

```http
POST /api/download
```

### Download Audio

```http
POST /api/audio
```

### Download Thumbnail

```http
POST /api/thumbnail
```

---

## License

This project is provided free for educational and personal use purposes.

Users are responsible for complying with the terms of service and copyright policies of the respective platforms.

---

## Author

**Kamran Abbasi**

GitHub Repository:

https://github.com/kamranabbaci/video-downloader
