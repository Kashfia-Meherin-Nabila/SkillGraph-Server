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
let userCollection;
let codeReviewsCollection;
let mentorAvailabilityCollection;
let mentorSessionsCollection;

export async function connectToMongoDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "skillgraph");
    userCollection = db.collection("user")
    coursesCollection = db.collection("courses");
    modulesCollection = db.collection("modules");
    progressCollection = db.collection("user_progress");
    skillsCollection = db.collection("skills");
    userSkillProgressCollection = db.collection("user_skill_progress");
    assessmentsCollection = db.collection("assessments");
    assessmentHistoryCollection = db.collection("assessment_history");
    codeReviewsCollection = db.collection("code_reviews");
    mentorAvailabilityCollection = db.collection("mentor_availability");
mentorSessionsCollection = db.collection("mentor_sessions");

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

/* ========================================================
   17.MENTOR DASHBOARD OVERVIEW API
======================================================== */


/* ========================================================
   17. MENTOR DASHBOARD OVERVIEW API
======================================================== */

app.get("/api/mentor/overview", async (req, res) => {
  try {
    const db = client.db(process.env.DB_NAME || "skillgraph");

    // Use the same collection initialized in connectToMongoDB().
    const usersCol = userCollection || db.collection("user");

    // These collections are resolved directly, avoiding
    // undeclared JavaScript variables.
    const reviewsCol = db.collection("codeReviews");
    const sessionsCol = db.collection("advisorySessions");

    const developerQuery = {
      $or: [
        { role: { $regex: /^developer$/i } },
        { type: { $regex: /^developer$/i } },
        { accountType: { $regex: /^developer$/i } },
      ],
    };

    const [
      activeMenteesCount,
      mentees,
      pendingReviewsCount,
      pendingReviews,
      upcomingCallsCount,
      upcomingSessions,
    ] = await Promise.all([
      usersCol.countDocuments(developerQuery),

      usersCol
        .find(developerQuery)
        .project({
          name: 1,
          email: 1,
          targetCareer: 1,
          createdAt: 1,
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),

      reviewsCol.countDocuments({
        status: {
          $in: ["Pending", "Submitted", "In Review"],
        },
      }),

      reviewsCol
        .find({
          status: {
            $in: ["Pending", "Submitted", "In Review"],
          },
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),

      sessionsCol.countDocuments({
        status: {
          $nin: ["Cancelled", "Completed"],
        },
      }),

      sessionsCol
        .find({
          status: {
            $nin: ["Cancelled", "Completed"],
          },
        })
        .sort({ date: 1 })
        .limit(5)
        .toArray(),
    ]);

    res.json({
      success: true,
      data: {
        activeMenteesCount,

        pendingReviewsCount,

        upcomingCallsCount,

        mentees: mentees.map((m) => ({
          id: String(m._id),
          name:
            m.name ||
            m.email?.split("@")[0] ||
            "Developer",
          career: m.targetCareer || "Not specified",
          readiness: null,
          status: "Active",
        })),

        pendingReviews: pendingReviews.map((r) => ({
          id: String(r._id),
          title: r.title || "Code Review",
          menteeName:
            r.menteeName ||
            r.email?.split("@")[0] ||
            "Developer",
          milestone: r.milestone || "General Milestone",
          createdAt: r.createdAt || null,
        })),

        upcomingSessions: upcomingSessions.map((s) => ({
          id: String(s._id),
          title: s.title || "1-on-1 Mentorship Call",
          menteeName: s.menteeName || "Developer",
          date: s.date || null,
          time: s.time || "As scheduled",
          meetingUrl: s.meetingUrl || "",
        })),
      },
    });
  } catch (err) {
    console.error("Failed to load mentor overview:", err);

    res.status(500).json({
      success: false,
      message: "Failed to load mentor overview",
      ...(process.env.NODE_ENV === "development" && {
        debug: err.message,
      }),
    });
  }
});


/* ========================================================
  18. MENTORS MENTEES DIRECTORY API
======================================================== */
  


app.get("/api/mentor/mentees", async (req, res) => {
  try {
    const db = client.db(process.env.DB_NAME || "skillgraph");

    const usersCol = userCollection || db.collection("user");
    const progressCol = progressCollection || db.collection("user_progress");
    const skillProgressCol =
      userSkillProgressCollection || db.collection("user_skill_progress");
    const skillsCol = skillsCollection || db.collection("skills");
    const modulesCol = modulesCollection || db.collection("modules");
    const historyCol =
      assessmentHistoryCollection || db.collection("assessment_history");

    const developers = await usersCol
      .find({ role: { $regex: /^developer$/i } })
      .project({
        name: 1,
        email: 1,
        targetCareer: 1,
        createdAt: 1,
      })
      .sort({ createdAt: -1 })
      .toArray();

    const data = await Promise.all(
      developers.map(async (dev) => {
        const email = String(dev.email || "").trim().toLowerCase();
        const courseSlug = String(dev.targetCareer || "frontend")
          .trim()
          .toLowerCase();

        const base = {
          id: String(dev._id),
          name: dev.name || email.split("@")[0] || "Developer",
          email,
          targetCareer: courseSlug,
          createdAt: dev.createdAt || null,
        };

        if (!email) {
          return {
            ...base,
            completedTasks: [],
            completedTasksCount: 0,
            totalTasksCount: 0,
            moduleProgressPercent: 0,
            assessedSkillsCount: 0,
            totalSkillsCount: 0,
            skillAssessmentPercent: 0,
            targetMatchPercent: 0,
            readiness: 0,
            skills: [],
            skillsCount: 0,
            completedAssessments: 0,
            status: "Not assessed",
          };
        }

        // Use the developer's selected career, not progress
        // records from unrelated career pathways.
        const [progress, modules, careerSkills, skillRecords, completedAssessments] =
          await Promise.all([
            progressCol.findOne({ email, courseSlug }),

            modulesCol
              .find({ courseSlug })
              .sort({ moduleId: 1 })
              .toArray(),

            skillsCol.find({ courseSlug }).toArray(),

            skillProgressCol.find({ email, courseSlug }).toArray(),

            historyCol.countDocuments({
              email,
              courseSlug,
              passed: true,
            }),
          ]);

        // Same task denominator as DeveloperOverviewPage:
        // all tasks in all modules for the selected career.
        const allTasks = modules.flatMap((module) =>
          Array.isArray(module.tasks) ? module.tasks : []
        );

        const completedTasks = Array.isArray(progress?.completedTasks)
          ? [...new Set(progress.completedTasks)]
          : [];

        const totalTasksCount = allTasks.length;
        const completedTasksCount = completedTasks.length;

        const moduleProgressPercent = totalTasksCount
          ? Math.round((completedTasksCount / totalTasksCount) * 100)
          : 0;

        // The Developer Skills page counts a skill as assessed
        // when its saved currentLevel is not null or undefined.
        const assessmentsBySkillId = new Map(
          skillRecords.map((record) => [
            String(record.skillId),
            record,
          ])
        );

        const skills = careerSkills.map((skill) => {
          const skillId = String(skill._id);
          const record = assessmentsBySkillId.get(skillId);

          const rawLevel = record?.currentLevel;
          const parsedLevel =
            rawLevel === null || rawLevel === undefined
              ? null
              : Number(rawLevel);

          const currentLevel =
            Number.isInteger(parsedLevel) &&
            parsedLevel >= 1 &&
            parsedLevel <= 5
              ? parsedLevel
              : null;

          const targetLevel = Math.min(
            5,
            Math.max(1, Number(skill.targetLevel) || 1)
          );

          const status =
            currentLevel === null
              ? "not-assessed"
              : currentLevel >= targetLevel
                ? "assessed"
                : record?.learningStatus === "in-progress"
                  ? "in-progress"
                  : "gap";

          return {
            id: record ? String(record._id) : skillId,
            skillId,
            name: skill.name || skill.title || "Unnamed Skill",
            category: skill.category || "General",
            currentLevel,
            targetLevel,
            status,
            evidence: record?.evidence || "",
            assessedAt: record?.assessedAt || null,
            hasGap:
              currentLevel !== null && currentLevel < targetLevel,
          };
        });

        const totalSkillsCount = careerSkills.length;

        const assessedSkills = skills.filter(
          (skill) => skill.currentLevel !== null
        );

        const verifiedSkills = skills.filter(
          (skill) => skill.status === "assessed"
        );

        const assessedSkillsCount = assessedSkills.length;

        const skillAssessmentPercent = totalSkillsCount
          ? Math.round((assessedSkillsCount / totalSkillsCount) * 100)
          : 0;

        const targetMatchPercent = totalSkillsCount
          ? Math.round((verifiedSkills.length / totalSkillsCount) * 100)
          : 0;

        return {
          ...base,

          // Task progress
          completedTasks,
          completedTasksCount,
          totalTasksCount,
          moduleProgressPercent,

          // Skill progress
          skills,
          skillsCount: totalSkillsCount,
          assessedSkillsCount,
          totalSkillsCount,
          skillAssessmentPercent,
          targetMatchPercent,

          // Keep this alias if the existing UI uses `readiness`.
          // It now means task completion, not proficiency.
          readiness: moduleProgressPercent,

          completedAssessments,
          status:
            totalSkillsCount === 0 || assessedSkillsCount === 0
              ? "Not assessed"
              : skills.some((skill) => skill.hasGap)
                ? "Skill gaps"
                : "On track",
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Failed to fetch mentees directory:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load mentees directory",
      ...(process.env.NODE_ENV !== "production" && {
        debug: error.message,
      }),
    });
  }
});

// 19. GET ALL CODE REVIEWS
app.get("/api/mentor/reviews", async (req, res) => {
  try {
    const db = client.db(process.env.DB_NAME || "skillgraph");
    const targetReviewsCol = codeReviewsCollection || db.collection("code_reviews");

    const reviews = await targetReviewsCol.find({}).sort({ createdAt: -1 }).toArray();

    const formattedReviews = reviews.map((r) => ({
      id: String(r._id),
      _id: String(r._id),
      title: r.title || "Code Review Submission",
      menteeName: r.menteeName || r.email?.split("@")[0] || "Developer",
      email: r.email || "",
      milestone: r.milestone || "General Milestone",
      repoUrl: r.repoUrl || "",
      notes: r.notes || "",
      status: r.status || "Pending Review",
      feedback: r.feedback || "",
      rubric: r.rubric || {
        codeQuality: 5,
        architecture: 5,
        security: 5,
        documentation: 5,
      },
      createdAt: r.createdAt
        ? new Date(r.createdAt).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
    }));

    res.json({
      success: true,
      count: formattedReviews.length,
      data: formattedReviews,
    });
  } catch (err) {
    console.error("Failed to fetch code reviews:", err);
    res.status(500).json({ success: false, message: "Failed to fetch code reviews." });
  }
});

// 20. PUT / UPDATE CODE REVIEW FEEDBACK & DECISION
app.put("/api/mentor/reviews", async (req, res) => {
  try {
    const db = client.db(process.env.DB_NAME || "skillgraph");
    const targetReviewsCol = codeReviewsCollection || db.collection("code_reviews");

    const { reviewId, status, feedback, rubric } = req.body;

    if (!reviewId || !ObjectId.isValid(reviewId)) {
      return res.status(400).json({ success: false, message: "Valid reviewId is required." });
    }

    const updateData = {
      status: status || "Approved",
      feedback: feedback || "",
      rubric: rubric || {},
      updatedAt: new Date(),
    };

    const result = await targetReviewsCol.updateOne(
      { _id: new ObjectId(reviewId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Review submission not found." });
    }

    res.json({
      success: true,
      message: "Review updated successfully.",
      data: updateData,
    });
  } catch (err) {
    console.error("Failed to update review:", err);
    res.status(500).json({ success: false, message: "Failed to save review feedback." });
  }
});


/* ========================================================
   MENTOR SESSIONS API
======================================================== */

const normalizeEmail = (value) =>
  String(value || "").trim().toLowerCase();

const allowedSessionStatuses = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
];

const allowedActionStatuses = [
  "todo",
  "in-progress",
  "completed",
];

const isValidDate = (value) =>
  value && !Number.isNaN(new Date(value).getTime());

async function getMentorByEmail(email) {
  return userCollection.findOne({
    email: normalizeEmail(email),
    role: "mentor",
  });
}

// GET mentor availability
app.get("/api/mentor/sessions/availability", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.query.mentorEmail);

    if (!mentorEmail) {
      return res.status(400).json({
        message: "Mentor email is required.",
      });
    }

    const mentor = await getMentorByEmail(mentorEmail);

    if (!mentor) {
      return res.status(403).json({
        message: "Mentor account not found.",
      });
    }

    const availability =
      await mentorAvailabilityCollection.findOne({ mentorEmail });

    res.json({
      availability: availability || {
        mentorEmail,
        timezone: "Asia/Dhaka",
        durationMinutes: 30,
        weeklySchedule: [],
        blockedDates: [],
      },
    });
  } catch (error) {
    console.error("Get mentor availability:", error);
    res.status(500).json({
      message: "Failed to load availability.",
    });
  }
});

// CREATE OR UPDATE mentor availability
app.put("/api/mentor/sessions/availability", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.body.mentorEmail);
    const { timezone, durationMinutes, weeklySchedule, blockedDates } =
      req.body;

    if (!mentorEmail) {
      return res.status(400).json({
        message: "Mentor email is required.",
      });
    }

    const mentor = await getMentorByEmail(mentorEmail);

    if (!mentor) {
      return res.status(403).json({
        message: "Only registered mentors can update availability.",
      });
    }

    const duration = Number(durationMinutes);

    if (![15, 30, 45, 60].includes(duration)) {
      return res.status(400).json({
        message: "Choose a valid session duration.",
      });
    }

    if (
      !Array.isArray(weeklySchedule) ||
      !Array.isArray(blockedDates)
    ) {
      return res.status(400).json({
        message: "Schedule and blocked dates must be arrays.",
      });
    }

    const validDays = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const validSchedule = weeklySchedule.every(
      (slot) =>
        validDays.includes(slot.day) &&
        /^\d{2}:\d{2}$/.test(slot.startTime) &&
        /^\d{2}:\d{2}$/.test(slot.endTime) &&
        slot.startTime < slot.endTime &&
        Number(slot.startTime.slice(0, 2)) < 24 &&
        Number(slot.startTime.slice(3, 5)) < 60 &&
        Number(slot.endTime.slice(0, 2)) < 24 &&
        Number(slot.endTime.slice(3, 5)) < 60
    );

    if (!validSchedule) {
      return res.status(400).json({
        message: "One or more availability time slots are invalid.",
      });
    }

    const document = {
      mentorEmail,
      timezone: String(timezone || "Asia/Dhaka"),
      durationMinutes: duration,
      weeklySchedule,
      blockedDates: blockedDates
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
      updatedAt: new Date(),
    };

    await mentorAvailabilityCollection.updateOne(
      { mentorEmail },
      {
        $set: document,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    res.json({
      success: true,
      message: "Availability saved successfully.",
      availability: document,
    });
  } catch (error) {
    console.error("Save mentor availability:", error);
    res.status(500).json({
      message: "Failed to save availability.",
    });
  }
});

// GET mentor's sessions
app.get("/api/mentor/sessions", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.query.mentorEmail);
    const status = String(req.query.status || "").trim();

    if (!mentorEmail) {
      return res.status(400).json({
        message: "Mentor email is required.",
      });
    }

    const mentor = await getMentorByEmail(mentorEmail);

    if (!mentor) {
      return res.status(403).json({
        message: "Mentor account not found.",
      });
    }

    const query = { mentorEmail };

    if (status && allowedSessionStatuses.includes(status)) {
      query.status = status;
    }

    const sessions = await mentorSessionsCollection
      .find(query)
      .sort({ startAt: 1 })
      .limit(200)
      .toArray();

    res.json({ sessions });
  } catch (error) {
    console.error("Get mentor sessions:", error);
    res.status(500).json({
      message: "Failed to load sessions.",
    });
  }
});

// CREATE a session
app.post("/api/mentor/sessions", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.body.mentorEmail);
    const menteeEmail = normalizeEmail(req.body.menteeEmail);

    const {
      title,
      description,
      startAt,
      endAt,
      meetingLink,
    } = req.body;

    if (
      !mentorEmail ||
      !menteeEmail ||
      !String(title || "").trim() ||
      !isValidDate(startAt) ||
      !isValidDate(endAt)
    ) {
      return res.status(400).json({
        message: "Provide a mentee, topic, start time, and end time.",
      });
    }

    const start = new Date(startAt);
    const end = new Date(endAt);

    if (end <= start || start <= new Date()) {
      return res.status(400).json({
        message: "The session must have a future start and valid end time.",
      });
    }

    const [mentor, mentee] = await Promise.all([
      getMentorByEmail(mentorEmail),
      userCollection.findOne({
        email: menteeEmail,
        role: "developer",
      }),
    ]);

    if (!mentor) {
      return res.status(403).json({
        message: "Only mentors can create sessions.",
      });
    }

    if (!mentee) {
      return res.status(404).json({
        message: "Developer/mentee account not found.",
      });
    }

    // Prevent overlapping sessions for this mentor.
    const overlap = await mentorSessionsCollection.findOne({
      mentorEmail,
      status: { $in: ["pending", "confirmed"] },
      startAt: { $lt: end },
      endAt: { $gt: start },
    });

    if (overlap) {
      return res.status(409).json({
        message: "This time overlaps another scheduled session.",
      });
    }

    const session = {
      mentorEmail,
      menteeEmail,
      menteeName: mentee.name || menteeEmail,
      title: String(title).trim().slice(0, 150),
      description: String(description || "").trim().slice(0, 2000),
      startAt: start,
      endAt: end,
      meetingLink: String(meetingLink || "").trim().slice(0, 1000),
      status: "pending",
      notes: "",
      actionItems: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await mentorSessionsCollection.insertOne(session);

    res.status(201).json({
      success: true,
      message: "Session created successfully.",
      session: { ...session, _id: result.insertedId },
    });
  } catch (error) {
    console.error("Create mentor session:", error);
    res.status(500).json({
      message: "Failed to create session.",
    });
  }
});

// UPDATE session status, meeting link, notes, or action items
app.patch("/api/mentor/sessions/:id", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.body.mentorEmail);
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid session ID.",
      });
    }

    const mentor = await getMentorByEmail(mentorEmail);

    if (!mentor) {
      return res.status(403).json({
        message: "Mentor account not found.",
      });
    }

    const session = await mentorSessionsCollection.findOne({
      _id: new ObjectId(id),
      mentorEmail,
    });

    if (!session) {
      return res.status(404).json({
        message: "Session not found.",
      });
    }

    const updates = {};

    if (req.body.status !== undefined) {
      if (!allowedSessionStatuses.includes(req.body.status)) {
        return res.status(400).json({
          message: "Invalid session status.",
        });
      }

      updates.status = req.body.status;
    }

    if (req.body.meetingLink !== undefined) {
      updates.meetingLink = String(req.body.meetingLink)
        .trim()
        .slice(0, 1000);
    }

    if (req.body.notes !== undefined) {
      updates.notes = String(req.body.notes).slice(0, 10000);
    }

    if (req.body.actionItems !== undefined) {
      if (!Array.isArray(req.body.actionItems)) {
        return res.status(400).json({
          message: "Action items must be an array.",
        });
      }

      if (req.body.actionItems.length > 30) {
        return res.status(400).json({
          message: "A session can have up to 30 action items.",
        });
      }

      const validItems = req.body.actionItems.every((item) => {
        const dueDateValid =
          !item.dueDate ||
          /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate);

        return (
          String(item.title || "").trim().length > 0 &&
          String(item.title).length <= 200 &&
          allowedActionStatuses.includes(item.status || "todo") &&
          dueDateValid
        );
      });

      if (!validItems) {
        return res.status(400).json({
          message: "One or more action items are invalid.",
        });
      }

      updates.actionItems = req.body.actionItems.map((item) => ({
        id: String(item.id || new ObjectId()),
        title: String(item.title).trim(),
        description: String(item.description || "").slice(0, 2000),
        dueDate: item.dueDate || "",
        status: item.status || "todo",
      }));
    }

    updates.updatedAt = new Date();

    await mentorSessionsCollection.updateOne(
      { _id: session._id, mentorEmail },
      { $set: updates }
    );

    const updatedSession = await mentorSessionsCollection.findOne({
      _id: session._id,
      mentorEmail,
    });

    res.json({
      success: true,
      message: "Session updated successfully.",
      session: updatedSession,
    });
  } catch (error) {
    console.error("Update mentor session:", error);
    res.status(500).json({
      message: "Failed to update session.",
    });
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
