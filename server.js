require("dotenv").config(); // 👈 ADD THIS FIRST

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const app = express();

/* ======================
   IMPORTANT DEPLOY FIX
====================== */
app.set("trust proxy", 1);

// 👇 NOW USING .env VALUE
const PORT = process.env.PORT || 3000;

/* ======================
   MIDDLEWARE
====================== */
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // true only if HTTPS
      sameSite: "lax"
    }
  })
);

/* ======================
   FILE PATHS
====================== */
const USERS_FILE = path.join(__dirname, "users.json");
const FILES_FILE = path.join(__dirname, "files.json");

/* ======================
   HELPERS
====================== */
function getUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function getFiles() {
  try {
    return JSON.parse(fs.readFileSync(FILES_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveFiles(files) {
  fs.writeFileSync(FILES_FILE, JSON.stringify(files, null, 2));
}

/* ======================
   CREATE DEFAULT USERS (SAFE)
====================== */
if (!fs.existsSync(USERS_FILE)) {
  const defaultUsers = [
    {
      username: "admin",
      password: bcrypt.hashSync("admin123", 10),
      role: "admin"
    }
  ];

  fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
}

/* ======================
   CREATE FILE STORAGE
====================== */
if (!fs.existsSync(FILES_FILE)) {
  fs.writeFileSync(FILES_FILE, "[]");
}

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

/* ======================
   LOGIN CHECK
====================== */
function requireLogin(req, res, next) {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/* ======================
   LOGIN
====================== */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const users = getUsers();
  const user = users.find(u => u.username === username);
console.log("LOGIN ATTEMPT:", username);
console.log("USERS FOUND:", users.length);
console.log("FOUND USER:", user);

  if (!user) {
    return res.json({ success: false, message: "Invalid login" });
  }

  let match = false;

  // Supports both plain-text and bcrypt passwords
  if (
    user.password.startsWith("$2a$") ||
    user.password.startsWith("$2b$") ||
    user.password.startsWith("$2y$")
  ) {
    match = await bcrypt.compare(password, user.password);
  } else {
    match = password === user.password;
  }

  if (!match) {
    return res.json({ success: false, message: "Invalid login" });
  }

  req.session.loggedIn = true;
  req.session.username = user.username;
  req.session.role = user.role;

  res.json({
    success: true,
    username: user.username,
    role: user.role
  });
});

/* ======================
   REGISTER
====================== */
app.post("/register", async (req, res) => {
  const { firstName, lastName, department, position, username, password } =
    req.body;

  if (!firstName || !lastName || !department || !position || !username || !password) {
    return res.json({ success: false, message: "Incomplete fields" });
  }

  const users = getUsers();

  const exists = users.find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );

  if (exists) {
    return res.json({ success: false, message: "Username exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  users.push({
    firstName,
    lastName,
    department,
    position,
    username,
    password: hashedPassword,
    role: "teacher",
    dateRegistered: new Date().toISOString()
  });

  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  res.json({ success: true, message: "Registered successfully" });
});

/* ======================
   CURRENT USER
====================== */
app.get("/me", requireLogin, (req, res) => {
  res.json({
    username: req.session.username,
    role: req.session.role
  });
});

/* ======================
   LOGOUT
====================== */
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login.html");
  });
});

/* ======================
   HOME
====================== */
app.get("/", (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect("/login.html");
  }

  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ======================
   ADMIN ONLY
====================== */
app.get("/admin", requireLogin, (req, res) => {
  if (req.session.role !== "admin") {
    return res.status(403).send("Access denied");
  }

  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/users", requireLogin, (req, res) => {
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Access denied" });
  }

  res.json(getUsers());
});

app.get("/admin/files", requireLogin, (req, res) => {
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Access denied" });
  }

  res.json(getFiles());
});

/* ======================
   UPLOAD CONFIG
====================== */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const grade = req.body.grade || "Grade7";
    const uploadPath = path.join(__dirname, "uploads", grade);

    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }

    cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }
});

/* ======================
   UPLOAD FILE
====================== */
app.post("/upload", requireLogin, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file" });
  }

  const files = getFiles();

  files.push({
    originalName: req.file.originalname,
    storedName: req.file.filename,
    grade: req.body.grade || "Grade7",
    uploadedBy: req.session.username,
    uploadDate: new Date()
  });

  saveFiles(files);

  res.json({ success: true });
});

/* ======================
   FILE LIST
====================== */
app.get("/files", requireLogin, (req, res) => {
  res.json(getFiles());
});

/* ======================
   DOWNLOAD
====================== */
app.get("/download/:grade/:filename", requireLogin, (req, res) => {
  const filePath = path.join(
    __dirname,
    "uploads",
    req.params.grade,
    req.params.filename
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Not found" });
  }

  res.download(filePath);
});

/* ======================
   DELETE (ADMIN ONLY)
====================== */
app.delete("/delete/:grade/:filename", requireLogin, (req, res) => {
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  const filePath = path.join(
    __dirname,
    "uploads",
    req.params.grade,
    req.params.filename
  );

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  let files = getFiles();

  files = files.filter(
    f => !(f.grade === req.params.grade && f.storedName === req.params.filename)
  );

  saveFiles(files);

  res.json({ success: true });
});

/* ======================
   START SERVER
====================== */
app.listen(PORT, () => {
  console.log(`RTSNHS File Hub running on port ${PORT}`);
});