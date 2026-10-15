import dns from "node:dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb";
import { ObjectId } from "mongodb";

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
let skillsCollection;
let userSkillProgressCollection;
let assessmentsCollection;
let assessmentHistoryCollection;

export async function connectToMongoDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "skillgraph");
    coursesCollection = db.collection("courses");
    modulesCollection = db.collection("modules");
    progressCollection = db.collection("user_progress");
    skillsCollection = db.collection("skills");
    userSkillProgressCollection = db.collection("user_skill_progress");
    assessmentsCollection = db.collection("assessments");
    assessmentHistoryCollection = db.collection("assessment_history");
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
    const filter = {
      email: email.toLowerCase(),
      courseSlug: courseSlug.toLowerCase(),
    };
    const update = completed
      ? {
          $addToSet: { completedTasks: taskId },
          $set: { updatedAt: new Date() },
        }
      : { $pull: { completedTasks: taskId }, $set: { updatedAt: new Date() } };
    await progressCollection.updateOne(filter, update, { upsert: true });
    const updated = await progressCollection.findOne(filter);
    res.json({ completedTasks: updated.completedTasks });
  } catch (err) {
    res.status(500).json({ error: "Failed to update progress" });
  }
});

/* ========================================================
   SKILLS API
======================================================== */

// 9.GET SKILLS BY CAREER
// Example: GET /api/skills?courseSlug=frontend
app.get("/api/skills", async (req, res) => {
  try {
    const courseSlug = String(req.query.courseSlug || "")
      .trim()
      .toLowerCase();

    if (!courseSlug) {
      return res.status(400).json({
        success: false,
        message: "courseSlug query parameter is required",
      });
    }

    if (!skillsCollection) {
      return res.status(503).json({
        success: false,
        message: "Skills collection is not initialized",
      });
    }

    const skills = await skillsCollection
      .find({ courseSlug })
      .sort({ name: 1 })
      .toArray();

    return res.status(200).json({
      success: true,
      count: skills.length,
      data: skills,
    });
  } catch (error) {
    console.error("Failed to fetch skills:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch skills",
    });
  }
});

/*10 GET saved assessments for one user and career */
app.get("/api/skill-progress/:email", async (req, res) => {
  try {
    const email = String(req.params.email || "")
      .trim()
      .toLowerCase();
    const courseSlug = String(req.query.courseSlug || "")
      .trim()
      .toLowerCase();

    if (!email || !courseSlug) {
      return res.status(400).json({
        success: false,
        message: "Email and courseSlug are required.",
      });
    }

    const assessments = await userSkillProgressCollection
      .find({ email, courseSlug })
      .toArray();

    return res.status(200).json({
      success: true,
      data: assessments,
    });
  } catch (error) {
    console.error("Failed to fetch skill assessments:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch skill assessments.",
    });
  }
});

/* 11. SAVE or update one skill assessment */
app.put("/api/skill-progress", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const courseSlug = String(req.body.courseSlug || "")
      .trim()
      .toLowerCase();

    const skillId = String(req.body.skillId || "").trim();
    const currentLevel = Number(req.body.currentLevel);
    const evidence = String(req.body.evidence || "").trim();

    const learningStatus = String(req.body.learningStatus || "gap").trim();

    const allowedLearningStatuses = ["gap", "in-progress"];

    if (
      !email ||
      !courseSlug ||
      !ObjectId.isValid(skillId) ||
      !Number.isInteger(currentLevel) ||
      currentLevel < 1 ||
      currentLevel > 5 ||
      !allowedLearningStatuses.includes(learningStatus)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provide valid skill details, a level from 1 to 5, and a valid learning status.",
      });
    }

    // Confirm that this skill exists for the selected career.
    const skill = await skillsCollection.findOne({
      _id: new ObjectId(skillId),
      courseSlug,
    });

    if (!skill) {
      return res.status(404).json({
        success: false,
        message: "Skill not found for this career.",
      });
    }

    const targetLevel = Number(skill.targetLevel) || 1;
    const assessedAt = new Date();

    // A skill meeting its target is always assessed.
    const status =
      currentLevel >= targetLevel
        ? "assessed"
        : learningStatus === "in-progress"
          ? "in-progress"
          : "gap";

    const assessmentData = {
      email,
      courseSlug,
      skillId,
      currentLevel,
      targetLevel,
      evidence,
      learningStatus,
      status,
      assessedAt,
    };

    await userSkillProgressCollection.updateOne(
      { email, courseSlug, skillId },
      {
        $set: assessmentData,
      },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Skill assessment saved successfully.",
      data: assessmentData,
    });
  } catch (error) {
    console.error("Failed to save skill assessment:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save skill assessment.",
    });
  }
});

/* ========================================================
   ROADMAP API — SKILLS + MODULES + USER PROGRESS
======================================================== */

// 12.GET /api/roadmap?courseSlug=frontend&email=user@example.com
app.get("/api/roadmap", async (req, res) => {
  try {
    const courseSlug = String(req.query.courseSlug || "")
      .trim()
      .toLowerCase();

    const email = String(req.query.email || "")
      .trim()
      .toLowerCase();

    if (!courseSlug) {
      return res.status(400).json({
        success: false,
        message: "courseSlug query parameter is required.",
      });
    }

    if (!skillsCollection || !modulesCollection || !progressCollection) {
      return res.status(503).json({
        success: false,
        message: "Database collections are not initialized.",
      });
    }

    // Fetch the existing skills for the selected career.
    const skills = await skillsCollection
      .find({ courseSlug })
      .sort({ priority: 1, name: 1 })
      .toArray();

    // Fetch the existing modules for this career.
    const modules = await modulesCollection
      .find({ courseSlug })
      .sort({ moduleId: 1 })
      .toArray();

    // Match each skill's moduleIds with modules.moduleId.
    const roadmap = skills.map((skill) => {
      const moduleIds = Array.isArray(skill.moduleIds)
        ? skill.moduleIds.map(Number)
        : [];

      const matchedModules = modules
        .filter((module) => moduleIds.includes(Number(module.moduleId)))
        .map((module) => ({
          _id: module._id,
          moduleId: module.moduleId,
          title: module.title,
          tasks: Array.isArray(module.tasks) ? module.tasks : [],
        }));

      return {
        ...skill,
        modules: matchedModules,
      };
    });

    // Load the user's existing completed tasks, if an email is supplied.
    let completedTasks = [];

    if (email) {
      const progress = await progressCollection.findOne({
        email,
        courseSlug,
      });

      completedTasks = progress?.completedTasks || [];
    }

    const allTasks = roadmap.flatMap((skill) =>
      skill.modules.flatMap((module) =>
        module.tasks.map((task) => ({
          ...task,
          skillId: skill._id,
          skillName: skill.name,
          moduleId: module.moduleId,
          moduleTitle: module.title,
        })),
      ),
    );

    const completedTaskSet = new Set(completedTasks);

    const completedCount = allTasks.filter((task) =>
      completedTaskSet.has(task.id),
    ).length;

    return res.status(200).json({
      success: true,
      courseSlug,
      summary: {
        totalSkills: roadmap.length,
        totalModules: new Set(
          roadmap.flatMap((skill) =>
            skill.modules.map(
              (module) => `${courseSlug}:${module.moduleId}`,
            ),
          ),
        ).size,
        totalTasks: allTasks.length,
        completedTasks: completedCount,
        progressPercentage: allTasks.length
          ? Math.round((completedCount / allTasks.length) * 100)
          : 0,
      },
      completedTasks,
      data: roadmap,
    });
  } catch (error) {
    console.error("Failed to generate roadmap:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to generate roadmap.",
    });
  }
});

/* ========================================================
   ASSESSMENTS APIS (QUIZZES & CODING CHALLENGES)
======================================================== */

// 13. GET ALL ASSESSMENTS BY COURSE SLUG
app.get("/api/assessments", async (req, res) => {
  try {
    const courseSlug = String(req.query.courseSlug || "frontend")
      .trim()
      .toLowerCase();

    const assessments = await assessmentsCollection
      .find({ courseSlug })
      .toArray();

    res.json({
      success: true,
      data: assessments,
    });
  } catch (err) {
    console.error("Failed to fetch assessments:", err);
    res.status(500).json({ success: false, message: "Failed to fetch assessments" });
  }
});

// 14. GET USER ASSESSMENT HISTORY & ATTEMPTS
app.get("/api/assessments/history/:email", async (req, res) => {
  try {
    const email = String(req.params.email || "").trim().toLowerCase();
    const courseSlug = String(req.query.courseSlug || "").trim().toLowerCase();

    const history = await assessmentHistoryCollection
      .find({ email, courseSlug })
      .toArray();

    res.json({
      success: true,
      data: history,
    });
  } catch (err) {
    console.error("Failed to fetch assessment history:", err);
    res.status(500).json({ success: false, message: "Failed to fetch history" });
  }
});

// 15. GET SINGLE ASSESSMENT WITH QUESTIONS (WITHOUT REVEALING CORRECT ANSWERS)
app.get("/api/assessments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid assessment ID" });
    }

    const assessment = await assessmentsCollection.findOne({ _id: new ObjectId(id) });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }

    // Strip out correct answers before sending questions to the client
    const sanitizedQuestions = (assessment.questions || []).map((q, index) => ({
      _id: q._id || index,
      type: q.type || "mcq",
      title: q.title || "",
      prompt: q.prompt || "",
      code: q.code || "",
      difficulty: q.difficulty || assessment.difficulty,
      options: q.options || [],
      examples: q.examples || [],
      constraints: q.constraints || [],
      starterCode: q.starterCode || "",
    }));

    res.json({
      success: true,
      data: {
        ...assessment,
        questions: sanitizedQuestions,
      },
    });
  } catch (err) {
    console.error("Failed to fetch assessment details:", err);
    res.status(500).json({ success: false, message: "Failed to load assessment" });
  }
});

// 16. SUBMIT ASSESSMENT AND GRADE ANSWERS
app.post("/api/assessments/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, courseSlug, answers, durationSeconds } = req.body;

    if (!email || !ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid submission data" });
    }

    const assessment = await assessmentsCollection.findOne({ _id: new ObjectId(id) });
    if (!assessment) {
      return res.status(404).json({ success: false, message: "Assessment not found" });
    }

    const questions = assessment.questions || [];
    let correctCount = 0;

    questions.forEach((q, idx) => {
      const userAns = answers.find(
        (a) => String(a.questionId) === String(q._id || idx)
      )?.answer;

      if (q.type === "coding") {
        // Basic check: awarded if user provided non-empty code solution
        if (typeof userAns === "string" && userAns.trim().length > 10) {
          correctCount++;
        }
      } else {
        // MCQ check against correctOption index
        if (Number(userAns) === Number(q.correctOption)) {
          correctCount++;
        }
      }
    });

    const totalQuestions = questions.length || 1;
    const percentage = Math.round((correctCount / totalQuestions) * 100);
    const passMark = Number(assessment.passMark) || 70;
    const passed = percentage >= passMark;

    const resultRecord = {
      assessmentId: String(assessment._id),
      email: email.toLowerCase(),
      courseSlug: (courseSlug || assessment.courseSlug || "frontend").toLowerCase(),
      percentage,
      correctCount,
      totalQuestions,
      passed,
      durationSeconds: Number(durationSeconds) || 0,
      completedAt: new Date(),
    };

    // Update or insert into user assessment history
    const existingHistory = await assessmentHistoryCollection.findOne({
      email: resultRecord.email,
      assessmentId: resultRecord.assessmentId,
    });

    const attempts = (existingHistory?.attempts || 0) + 1;
    const bestScore = Math.max(existingHistory?.bestScore || 0, percentage);
    const everPassed = Boolean(existingHistory?.passed || passed);

    await assessmentHistoryCollection.updateOne(
      { email: resultRecord.email, assessmentId: resultRecord.assessmentId },
      {
        $set: {
          ...resultRecord,
          attempts,
          bestScore,
          passed: everPassed,
          badge: everPassed
            ? {
                name: assessment.badgeName || `${assessment.title} Badge`,
                earnedAt: existingHistory?.badge?.earnedAt || new Date(),
              }
            : null,
        },
      },
      { upsert: true }
    );

    res.json({
      success: true,
      data: {
        percentage,
        correctCount,
        totalQuestions,
        passed,
        badge: everPassed ? { name: assessment.badgeName } : null,
      },
    });
  } catch (err) {
    console.error("Failed to grade assessment:", err);
    res.status(500).json({ success: false, message: "Failed to process submission" });
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
