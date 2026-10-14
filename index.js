import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Client
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
let coursesCollection;
let modulesCollection;
let progressCollection;

export async function connectToMongoDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "skillgraph");
    coursesCollection = db.collection("courses");
    modulesCollection = db.collection("modules"); 
    progressCollection = db.collection("user_progress");
    console.log("Successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}

/* ========================================================
   COURSES CRUD APIS
======================================================== */
// 1. GET ALL COURSES (READ)
app.get("/api/courses", async (req, res) => {
  try {
    const courses = await coursesCollection.find({}).toArray();
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});
// 2. GET SINGLE COURSE BY SLUG, ID, OR TITLE
app.get("/api/courses/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const cleanId = decodeURIComponent(identifier).trim();

    // Check if identifier is a valid 24-character hex MongoDB ObjectId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(cleanId);

    const query = isObjectId
      ? { _id: new ObjectId(cleanId) }
      : {
          $or: [
            { slug: cleanId.toLowerCase() },
            { slug: { $regex: `^${cleanId}$`, $options: "i" } },
            { title: { $regex: cleanId, $options: "i" } },
          ],
        };

    const course = await coursesCollection.findOne(query);

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(course);
  } catch (err) {
    console.error("Failed to fetch course:", err);
    res.status(500).json({ error: err.message || "Failed to fetch course" });
  }
});
// 3. CREATE NEW COURSE
app.post("/api/courses", async (req, res) => {
  try {
    const {
      title,
      slug,
      description,
      level,
      duration,
      modulesCount,
      skills,
      badgeColor,
    } = req.body;
    if (!title || !slug) {
      return res.status(400).json({ error: "Title and slug are required" });
    }
    const newCourse = {
      title,
      slug: slug.toLowerCase().trim(),
      description: description || "",
      level: level || "All Levels",
      duration: duration || "Self-paced",
      modulesCount: Number(modulesCount) || 1,
      skills: Array.isArray(skills)
        ? skills
        : (skills || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      badgeColor: badgeColor || "bg-blue-50 text-cobalt border-blue-200",
      createdAt: new Date(),
    };
    const result = await coursesCollection.insertOne(newCourse);
    res.status(201).json({ ...newCourse, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Failed to create course" });
  }
});
// 4. UPDATE COURSE BY ID
app.put("/api/courses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      slug,
      description,
      level,
      duration,
      modulesCount,
      skills,
      badgeColor,
    } = req.body;
    const updatedData = {
      title,
      slug: slug.toLowerCase().trim(),
      description,
      level,
      duration,
      modulesCount: Number(modulesCount),
      skills: Array.isArray(skills)
        ? skills
        : (skills || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      badgeColor,
      updatedAt: new Date(),
    };
    const result = await coursesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Course not found" });
    }
    res.json({ message: "Course updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update course" });
  }
});
// 5. DELETE COURSE BY ID
app.delete("/api/courses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await coursesCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Course not found" });
    }
    res.json({ message: "Course deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete course" });
  }
});

/* ========================================================
   MODULES & PROGRESS APIS (Pure DB queries)
======================================================== */
// 6. GET MODULES FOR A COURSE
app.get("/api/courses/:slug/modules", async (req, res) => {
  try {
    const { slug } = req.params;
    const modules = await modulesCollection
      .find({ courseSlug: slug.toLowerCase() })
      .sort({ moduleId: 1 })
      .toArray();
    res.json(modules);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch modules" });
  }
});
// 7. GET USER PROGRESS (Starts at 0 completed tasks)
app.get("/api/progress/:email/:courseSlug", async (req, res) => {
  try {
    const { email, courseSlug } = req.params;
    const progress = await progressCollection.findOne({
      email: email.toLowerCase(),
      courseSlug: courseSlug.toLowerCase(),
    });
    res.json({
      completedTasks: progress?.completedTasks || [],
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user progress" });
  }
});
// 8. TOGGLE TASK COMPLETION IN MONGODB
app.post("/api/progress/toggle", async (req, res) => {
  try {
    const { email, courseSlug, taskId, completed } = req.body;
    if (!email || !courseSlug || !taskId) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const filter = { email: email.toLowerCase(), courseSlug: courseSlug.toLowerCase() };
    const update = completed
      ? { $addToSet: { completedTasks: taskId }, $set: { updatedAt: new Date() } }
      : { $pull: { completedTasks: taskId }, $set: { updatedAt: new Date() } };
    await progressCollection.updateOne(filter, update, { upsert: true });
    const updated = await progressCollection.findOne(filter);
    res.json({ completedTasks: updated.completedTasks });
  } catch (err) {
    res.status(500).json({ error: "Failed to update progress" });
  }
});

// Call this only when application terminates
export async function disconnectFromMongoDB() {
  await client.close();
}

// Test Route
app.get("/", (req, res) => {
  res.send("SkillGraph Server is running!");
});

// Connect to DB and start server
connectToMongoDB().then(() => {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
