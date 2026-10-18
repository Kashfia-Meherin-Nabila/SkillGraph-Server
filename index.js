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
let quizzesCollection;
let challengesCollection;
let quizSessionsCollection;
let challengeProgressCollection;
let mentorRequestsCollection;

export async function connectToMongoDB() {
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || "skillgraph");
    userCollection = db.collection("user");
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
    const existingNames = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (item) => item.name,
      ),
    );
    const pickName = (candidates) =>
      candidates.find((name) => existingNames.has(name)) || candidates[0];

    quizzesCollection = db.collection(
      process.env.QUIZZES_COLLECTION || pickName(["quizzes", "quizes", "quiz"]),
    );
    challengesCollection = db.collection(
      process.env.CHALLENGES_COLLECTION ||
        pickName([
          "coding-challenges",
          "coding_challenges",
          "codingChallenges",
          "challenges",
        ]),
    );
    quizSessionsCollection = db.collection("quiz_sessions");
    challengeProgressCollection = db.collection("challenge_progress");

    console.log(
      `Assessments using "${quizzesCollection.collectionName}" and "${challengesCollection.collectionName}"`,
    );
    // mentor request
    mentorRequestsCollection = db.collection("mentor_requests");

    // One pending request per developer and mentor.
    await mentorRequestsCollection.createIndex(
      { mentorEmail: 1, menteeEmail: 1 },
      { unique: true },
    );

    // Fast lookups for each mentor's requests.
    await mentorRequestsCollection.createIndex({
      mentorEmail: 1,
      status: 1,
      createdAt: -1,
    });

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
            skill.modules.map((module) => `${courseSlug}:${module.moduleId}`),
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
const BADGE_TIERS = [
  { name: "Gold", min: 90 },
  { name: "Silver", min: 75 },
  { name: "Bronze", min: 60 },
];
const QUIZ_WEIGHT = 0.7;
const CHALLENGE_WEIGHT = 0.3;
const DEFAULT_PASS_MARK = 70;
const SUBMIT_GRACE_SECONDS = 30; // network delay allowance on timed quizzes

const cleanEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const cleanSlug = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Quiz questions may store the answer under any of these names.
function correctIndexOf(question) {
  for (const key of ["correctIndex", "correctOption", "correctAnswer"]) {
    const raw = question?.[key];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (Number.isInteger(n)) return n;
  }
  return -1;
}

const questionKey = (question, index) =>
  String(question.id ?? question._id ?? index);

// Roadmap completion -> decides whether the final quiz is unlocked.
async function getRoadmapProgress(email, courseSlug) {
  const [modules, progress] = await Promise.all([
    modulesCollection.find({ courseSlug }).project({ tasks: 1 }).toArray(),
    progressCollection.findOne({ email, courseSlug }),
  ]);

  const taskIds = new Set(
    modules
      .flatMap((module) => (Array.isArray(module.tasks) ? module.tasks : []))
      .map((task) => task?.id)
      .filter(Boolean),
  );

  const done = new Set(
    Array.isArray(progress?.completedTasks) ? progress.completedTasks : [],
  );

  const totalTasks = taskIds.size;
  const completedTasks = [...taskIds].filter((id) => done.has(id)).length;

  return {
    totalTasks,
    completedTasks,
    percentage: totalTasks
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0,
    unlocked: totalTasks > 0 && completedTasks >= totalTasks,
  };
}

// Badge = 70% best quiz score + 30% share of coding challenges solved.
async function computeBadge(email, courseSlug, quizHistory) {
  const history =
    quizHistory !== undefined
      ? quizHistory
      : await assessmentHistoryCollection.findOne({
          email,
          courseSlug,
          kind: "quiz",
        });

  const [totalChallenges, solvedChallenges] = await Promise.all([
    challengesCollection.countDocuments({ courseSlug }),
    challengeProgressCollection.countDocuments({
      email,
      courseSlug,
      solved: true,
    }),
  ]);

  const quizBest = Math.round(Number(history?.bestScore) || 0);
  const quizPassed = Boolean(history?.passed);

  const challengePct = totalChallenges
    ? Math.round(
        (Math.min(solvedChallenges, totalChallenges) / totalChallenges) * 100,
      )
    : 0;

  const score = Math.round(
    quizBest * QUIZ_WEIGHT + challengePct * CHALLENGE_WEIGHT,
  );

  // A badge needs a passed quiz AND a high enough overall score.
  const tier = quizPassed
    ? (BADGE_TIERS.find((item) => score >= item.min)?.name ?? null)
    : null;

  // Lowest tier that is still above the current score.
  const next = [...BADGE_TIERS].reverse().find((item) => item.min > score);

  return {
    tier,
    score,
    quizBest,
    challengePct,
    tiers: BADGE_TIERS,
    nextTier: next ? { name: next.name, pointsNeeded: next.min - score } : null,
  };
}

/* ---------- OVERVIEW: everything the hub page needs in one call ---------- */
// 12.GET /api/assessments/overview?
app.get("/api/assessments/overview", async (req, res) => {
  try {
    const email = cleanEmail(req.query.email);
    const courseSlug = cleanSlug(req.query.courseSlug);

    if (!email || !courseSlug) {
      return res.status(400).json({
        success: false,
        message: "email and courseSlug are required.",
      });
    }

    const [progress, quizDoc, quizHistory, challenges, challengeRows] =
      await Promise.all([
        getRoadmapProgress(email, courseSlug),
        quizzesCollection.findOne({ courseSlug }),
        assessmentHistoryCollection.findOne({
          email,
          courseSlug,
          kind: "quiz",
        }),
        challengesCollection
          .find({ courseSlug })
          .project({
            title: 1,
            description: 1,
            skillName: 1,
            difficulty: 1,
            language: 1,
          })
          .sort({ title: 1 })
          .toArray(),
        challengeProgressCollection.find({ email, courseSlug }).toArray(),
      ]);

    const badge = await computeBadge(email, courseSlug, quizHistory);
    const rowsByChallenge = new Map(
      challengeRows.map((row) => [String(row.challengeId), row]),
    );

    const quiz = quizDoc
      ? {
          _id: String(quizDoc._id),
          title: quizDoc.title || "Final Quiz",
          description: quizDoc.description || "",
          questionCount: Array.isArray(quizDoc.questions)
            ? quizDoc.questions.length
            : 0,
          timeLimitMinutes: Number(quizDoc.timeLimitMinutes) || 0,
          passMark: Number(quizDoc.passMark) || DEFAULT_PASS_MARK,
          attempts: quizHistory?.attempts || 0,
          bestScore: Math.round(quizHistory?.bestScore || 0),
          passed: Boolean(quizHistory?.passed),
          lastAttemptAt: quizHistory?.lastAttemptAt || null,
        }
      : null;

    return res.json({
      success: true,
      data: {
        progress,
        quiz,
        badge,
        challenges: challenges.map((item) => {
          const row = rowsByChallenge.get(String(item._id));
          return {
            _id: String(item._id),
            title: item.title || "Untitled challenge",
            description: item.description || "",
            skillName: item.skillName || "",
            difficulty: item.difficulty || "Intermediate",
            language: item.language || "JavaScript",
            solved: Boolean(row?.solved),
            attempts: row?.attempts || 0,
            lastAttemptAt: row?.lastAttemptAt || null,
          };
        }),
      },
    });
  } catch (error) {
    console.error("Failed to load assessments overview:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load assessments." });
  }
});

/* ---------- START the final quiz (server-enforced unlock + timer) -------- */
// 13.POST /api/assessments/quiz/start   { email, courseSlug }
app.post("/api/assessments/quiz/start", async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const courseSlug = cleanSlug(req.body.courseSlug);

    if (!email || !courseSlug) {
      return res.status(400).json({
        success: false,
        message: "email and courseSlug are required.",
      });
    }

    const quizDoc = await quizzesCollection.findOne({ courseSlug });
    const questions = Array.isArray(quizDoc?.questions)
      ? quizDoc.questions
      : [];

    if (!quizDoc || questions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No final quiz is available for this career yet.",
      });
    }

    const progress = await getRoadmapProgress(email, courseSlug);

    if (!progress.unlocked) {
      return res.status(403).json({
        success: false,
        message: "Complete every roadmap task to unlock the final quiz.",
      });
    }

    const timeLimitMinutes = Number(quizDoc.timeLimitMinutes) || 0;
    const passMark = Number(quizDoc.passMark) || DEFAULT_PASS_MARK;
    const now = new Date();

    // Drop abandoned, unsubmitted attempts so sessions don't pile up.
    await quizSessionsCollection.deleteMany({
      email,
      courseSlug,
      submittedAt: null,
    });

    const session = await quizSessionsCollection.insertOne({
      email,
      courseSlug,
      quizId: quizDoc._id,
      questionIds: questions.map(questionKey),
      startedAt: now,
      deadline: timeLimitMinutes
        ? new Date(now.getTime() + timeLimitMinutes * 60 * 1000)
        : null,
      submittedAt: null,
    });

    // Never send the correct answers or explanations to the browser.
    return res.json({
      success: true,
      data: {
        sessionId: String(session.insertedId),
        quiz: {
          title: quizDoc.title || "Final Quiz",
          timeLimitMinutes,
          passMark,
        },
        questions: questions.map((question, index) => ({
          id: questionKey(question, index),
          prompt: question.prompt || question.question || question.title || "",
          code: question.code || "",
          options: Array.isArray(question.options)
            ? question.options.map(String)
            : [],
        })),
      },
    });
  } catch (error) {
    console.error("Failed to start final quiz:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not start the final quiz." });
  }
});

//14. POST /api/assessments/quiz/submit
//   { email, sessionId, answers:[{ questionId, answer }] }
app.post("/api/assessments/quiz/submit", async (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const sessionId = String(req.body.sessionId || "");
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];

    if (!email || !ObjectId.isValid(sessionId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid submission." });
    }

    // Claim the session atomically so it can only be graded once.
    const now = new Date();
    const claimed = await quizSessionsCollection.findOneAndUpdate(
      { _id: new ObjectId(sessionId), email, submittedAt: null },
      { $set: { submittedAt: now } },
    );
    const session = claimed?.value !== undefined ? claimed.value : claimed;

    if (!session) {
      return res.status(409).json({
        success: false,
        message: "This quiz attempt was already submitted or doesn't exist.",
      });
    }

    if (
      session.deadline &&
      now.getTime() > session.deadline.getTime() + SUBMIT_GRACE_SECONDS * 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Time limit exceeded. Please start a new attempt.",
      });
    }

    const quizDoc = await quizzesCollection.findOne({ _id: session.quizId });

    if (!quizDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Quiz no longer exists." });
    }

    const questionsByKey = new Map(
      (quizDoc.questions || []).map((question, index) => [
        questionKey(question, index),
        question,
      ]),
    );

    const answersByKey = new Map(
      answers.map((entry) => [String(entry?.questionId), entry?.answer]),
    );

    let score = 0;

    const results = session.questionIds.map((key) => {
      const question = questionsByKey.get(key);
      const correctIndex = question ? correctIndexOf(question) : -1;
      const given = answersByKey.get(key);
      const correct = Number.isInteger(given) && given === correctIndex;

      if (correct) score += 1;

      return {
        questionId: key,
        correct,
        correctIndex,
        explanation: question?.explanation || "",
      };
    });

    const total = session.questionIds.length;
    const percentage = total ? Math.round((score / total) * 100) : 0;
    const passMark = Number(quizDoc.passMark) || DEFAULT_PASS_MARK;
    const passed = percentage >= passMark;

    // Keep one history document per user + career for the final quiz.
    await assessmentHistoryCollection.updateOne(
      { email, courseSlug: session.courseSlug, kind: "quiz" },
      {
        $inc: { attempts: 1 },
        $max: { bestScore: percentage },
        $set: {
          quizId: String(session.quizId),
          lastScore: percentage,
          lastAttemptAt: now,
          ...(passed ? { passed: true } : {}),
        },
        ...(passed ? {} : { $setOnInsert: { passed: false } }),
      },
      { upsert: true },
    );

    const badge = await computeBadge(email, session.courseSlug);

    return res.json({
      success: true,
      data: { score, total, percentage, passed, passMark, badge, results },
    });
  } catch (error) {
    console.error("Failed to submit final quiz:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not submit the quiz." });
  }
});

//15. GET /api/assessments/challenges/:id
app.get("/api/assessments/challenges/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid challenge ID." });
    }

    const challenge = await challengesCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!challenge) {
      return res
        .status(404)
        .json({ success: false, message: "Challenge not found." });
    }

    return res.json({
      success: true,
      data: {
        _id: String(challenge._id),
        title: challenge.title || "Untitled challenge",
        difficulty: challenge.difficulty || "Intermediate",
        skillName: challenge.skillName || "",
        language: challenge.language || "JavaScript",
        prompt: challenge.prompt || challenge.description || "",
        examples: Array.isArray(challenge.examples) ? challenge.examples : [],
        constraints: Array.isArray(challenge.constraints)
          ? challenge.constraints
          : [],
        functionName: challenge.functionName || "solution",
        starterCode: challenge.starterCode || "",
        tests: (Array.isArray(challenge.tests) ? challenge.tests : []).map(
          (test) => {
            const rawArgs = test.args ?? test.input;
            return {
              args: Array.isArray(rawArgs)
                ? rawArgs
                : rawArgs === undefined
                  ? []
                  : [rawArgs],
              expected: test.expected ?? test.output,
            };
          },
        ),
      },
    });
  } catch (error) {
    console.error("Failed to load challenge:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not load this challenge." });
  }
});

// 16.POST /api/assessments/challenges/:id/submit   { email, passedTests, code }
app.post("/api/assessments/challenges/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const email = cleanEmail(req.body.email);

    if (!email || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid submission." });
    }

    const challenge = await challengesCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!challenge) {
      return res
        .status(404)
        .json({ success: false, message: "Challenge not found." });
    }

    // Trust the stored number of tests, not the one sent by the browser.
    const totalTests = Array.isArray(challenge.tests)
      ? challenge.tests.length
      : 0;
    const passedTests = Math.min(
      totalTests,
      Math.max(0, Math.floor(Number(req.body.passedTests) || 0)),
    );
    const solvedNow = totalTests > 0 && passedTests === totalTests;
    const courseSlug = cleanSlug(challenge.courseSlug || req.body.courseSlug);
    const now = new Date();

    const filter = { email, challengeId: String(challenge._id) };

    const existing = await challengeProgressCollection.findOne(filter);

    await challengeProgressCollection.updateOne(
      filter,
      {
        $inc: { attempts: 1 },
        $max: { bestPassed: passedTests },
        $set: {
          courseSlug,
          totalTests,
          lastPassed: passedTests,
          lastAttemptAt: now,
          lastCode: String(req.body.code || "").slice(0, 20000),
          // Once solved, a later failing attempt must not un-solve it.
          solved: Boolean(existing?.solved) || solvedNow,
        },
      },
      { upsert: true },
    );

    return res.json({
      success: true,
      data: {
        solved: solvedNow,
        passedTests,
        totalTests,
        badge: await computeBadge(email, courseSlug),
      },
    });
  } catch (error) {
    console.error("Failed to submit challenge:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not save your submission." });
  }
});

//17. GET developer mentorship dashboard data
app.get("/api/developer/mentorship", async (req, res) => {
  try {
    const email = String(req.query.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Developer email is required.",
      });
    }

    const db = client.db(process.env.DB_NAME || "skillgraph");

    const users = userCollection || db.collection("user");
    const reviews = codeReviewsCollection || db.collection("code_reviews");
    const sessions =
      mentorSessionsCollection || db.collection("mentor_sessions");

    const developer = await users.findOne({ email });

    if (!developer) {
      return res.status(404).json({
        success: false,
        message: "Developer account not found.",
      });
    }

    const [reviewData, sessionData] = await Promise.all([
      reviews.find({ email }).sort({ createdAt: -1 }).limit(50).toArray(),

      sessions
        .find({ menteeEmail: email })
        .sort({ startAt: 1 })
        .limit(50)
        .toArray(),
    ]);

    const mentorEmail = String(
      developer.assignedMentorEmail || developer.mentorEmail || "",
    )
      .trim()
      .toLowerCase();

    const mentor = mentorEmail
      ? await users.findOne({
          email: mentorEmail,
          role: "mentor",
        })
      : null;

    return res.json({
      success: true,
      data: {
        mentor: mentor
          ? {
              name: mentor.name || "Mentor",
              email: mentor.email,
              expertise:
                mentor.expertise ||
                mentor.targetCareer ||
                "Software Development Mentor",
              title: mentor.title || "Software Development Mentor",
              avatar: mentor.image || mentor.avatar || "",
              rating: mentor.rating ?? null,
              bio: mentor.bio || "",
            }
          : null,

        reviews: reviewData.map((review) => ({
          id: String(review._id),
          title: review.title || "Code Review",
          milestone: review.milestone || "General Milestone",
          status: review.status || "Pending Review",
          repoUrl: review.repoUrl || "",
          feedback: review.feedback || "",
          createdAt: review.createdAt || null,
        })),

        messages: [],

        sessions: sessionData.map((session) => ({
          id: String(session._id),
          title: session.title || "Mentorship Session",
          date: session.startAt || session.date || null,
          time: session.time || "",
          meetingUrl: session.meetingLink || session.meetingUrl || "",
        })),
      },
    });
  } catch (error) {
    console.error("Failed to load developer mentorship:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load mentorship data.",
    });
  }
});

/* ========================================================
   18. MENTOR DASHBOARD OVERVIEW API
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
          name: m.name || m.email?.split("@")[0] || "Developer",
          career: m.targetCareer || "Not specified",
          readiness: null,
          status: "Active",
        })),

        pendingReviews: pendingReviews.map((r) => ({
          id: String(r._id),
          title: r.title || "Code Review",
          menteeName: r.menteeName || r.email?.split("@")[0] || "Developer",
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
  19. MENTORS MENTEES DIRECTORY API
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
        const email = String(dev.email || "")
          .trim()
          .toLowerCase();
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
        const [
          progress,
          modules,
          careerSkills,
          skillRecords,
          completedAssessments,
        ] = await Promise.all([
          progressCol.findOne({ email, courseSlug }),

          modulesCol.find({ courseSlug }).sort({ moduleId: 1 }).toArray(),

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
          Array.isArray(module.tasks) ? module.tasks : [],
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
          skillRecords.map((record) => [String(record.skillId), record]),
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
            Math.max(1, Number(skill.targetLevel) || 1),
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
            hasGap: currentLevel !== null && currentLevel < targetLevel,
          };
        });

        const totalSkillsCount = careerSkills.length;

        const assessedSkills = skills.filter(
          (skill) => skill.currentLevel !== null,
        );

        const verifiedSkills = skills.filter(
          (skill) => skill.status === "assessed",
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
      }),
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

// 20. GET ALL CODE REVIEWS
app.get("/api/mentor/reviews", async (req, res) => {
  try {
    const db = client.db(process.env.DB_NAME || "skillgraph");
    const targetReviewsCol =
      codeReviewsCollection || db.collection("code_reviews");

    const reviews = await targetReviewsCol
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

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
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch code reviews." });
  }
});

// 21. PUT / UPDATE CODE REVIEW FEEDBACK & DECISION
app.put("/api/mentor/reviews", async (req, res) => {
  try {
    const db = client.db(process.env.DB_NAME || "skillgraph");
    const targetReviewsCol =
      codeReviewsCollection || db.collection("code_reviews");

    const { reviewId, status, feedback, rubric } = req.body;

    if (!reviewId || !ObjectId.isValid(reviewId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid reviewId is required." });
    }

    const updateData = {
      status: status || "Approved",
      feedback: feedback || "",
      rubric: rubric || {},
      updatedAt: new Date(),
    };

    const result = await targetReviewsCol.updateOne(
      { _id: new ObjectId(reviewId) },
      { $set: updateData },
    );

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Review submission not found." });
    }

    res.json({
      success: true,
      message: "Review updated successfully.",
      data: updateData,
    });
  } catch (err) {
    console.error("Failed to update review:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to save review feedback." });
  }
});

/* ========================================================
   MENTOR SESSIONS API
======================================================== */

const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const allowedSessionStatuses = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
];

const allowedActionStatuses = ["todo", "in-progress", "completed"];

const isValidDate = (value) =>
  value && !Number.isNaN(new Date(value).getTime());

async function getMentorByEmail(email) {
  return userCollection.findOne({
    email: normalizeEmail(email),
    role: "mentor",
  });
}

/* ========================================================
   SKILLGRAPH MENTORSHIP WORKFLOW
======================================================== */

const mentorCapacityOptions = [15, 20];

const mentorshipResponse = (res, status, message, extra = {}) =>
  res.status(status).json({
    success: status < 400,
    message,
    ...extra,
  });

// GET: public mentor marketplace
app.get("/api/mentorship/mentors", async (req, res) => {
  try {
    const mentors = await userCollection
      .find({ role: "mentor" })
      .project({
        name: 1,
        email: 1,
        image: 1,
        avatar: 1,
        expertise: 1,
        bio: 1,
        title: 1,
        targetCareer: 1,
        menteeCapacity: 1,
        activeMenteeCount: 1,
      })
      .sort({ name: 1 })
      .toArray();

    const data = await Promise.all(
      mentors.map(async (mentor) => {
        const email = normalizeEmail(mentor.email);
        const capacity = mentorCapacityOptions.includes(
          Number(mentor.menteeCapacity),
        )
          ? Number(mentor.menteeCapacity)
          : 15;

        // Count approved requests as the displayed source of truth.
        const activeMentees = await mentorRequestsCollection.countDocuments({
          mentorEmail: email,
          status: "approved",
        });

        return {
          id: String(mentor._id),
          name: mentor.name || email.split("@")[0],
          email,
          image: mentor.image || mentor.avatar || "",
          expertise:
            mentor.expertise || mentor.targetCareer || "Software Development",
          bio: mentor.bio || "",
          title: mentor.title || "Software Development Mentor",
          capacity,
          activeMentees,
          availableSlots: Math.max(0, capacity - activeMentees),
          isAvailable: activeMentees < capacity,
        };
      }),
    );

    return res.json({ success: true, data });
  } catch (error) {
    console.error("Load mentor marketplace:", error);
    return mentorshipResponse(res, 500, "Failed to load mentor marketplace.");
  }
});

// GET: mentorship requests for a developer or mentor
app.get("/api/mentorship/requests", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.query.mentorEmail);
    const menteeEmail = normalizeEmail(req.query.menteeEmail);

    if (!mentorEmail && !menteeEmail) {
      return mentorshipResponse(
        res,
        400,
        "Provide mentorEmail or menteeEmail.",
      );
    }

    const query = mentorEmail ? { mentorEmail } : { menteeEmail };

    const requests = await mentorRequestsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    return res.json({
      success: true,
      data: requests.map((request) => ({
        ...request,
        id: String(request._id),
        _id: String(request._id),
      })),
    });
  } catch (error) {
    console.error("Load mentorship requests:", error);
    return mentorshipResponse(res, 500, "Failed to load requests.");
  }
});

// POST: developer requests a mentor
app.post("/api/mentorship/requests", async (req, res) => {
  try {
    const menteeEmail = normalizeEmail(req.body.menteeEmail);
    const mentorEmail = normalizeEmail(req.body.mentorEmail);
    const message = String(req.body.message || "")
      .trim()
      .slice(0, 1500);

    if (!menteeEmail || !mentorEmail) {
      return mentorshipResponse(
        res,
        400,
        "Developer and mentor email are required.",
      );
    }

    const [mentee, mentor] = await Promise.all([
      userCollection.findOne({
        email: menteeEmail,
        role: "developer",
      }),
      getMentorByEmail(mentorEmail),
    ]);

    if (!mentee) {
      return mentorshipResponse(res, 404, "Developer account not found.");
    }

    if (!mentor) {
      return mentorshipResponse(res, 404, "Mentor account not found.");
    }

    if (
      normalizeEmail(mentee.assignedMentorEmail || mentee.mentorEmail) ===
      mentorEmail
    ) {
      return mentorshipResponse(res, 409, "You already have this mentor.");
    }

    const capacity = mentorCapacityOptions.includes(
      Number(mentor.menteeCapacity),
    )
      ? Number(mentor.menteeCapacity)
      : 15;

    const activeCount = await mentorRequestsCollection.countDocuments({
      mentorEmail,
      status: "approved",
    });

    if (activeCount >= capacity) {
      return mentorshipResponse(
        res,
        409,
        "This mentor has no available slots.",
      );
    }

    const existing = await mentorRequestsCollection.findOne({
      mentorEmail,
      menteeEmail,
    });

    if (existing) {
      if (existing.status === "pending") {
        return mentorshipResponse(res, 409, "Your request is already pending.");
      }

      if (existing.status === "approved") {
        return mentorshipResponse(
          res,
          409,
          "Your mentorship is already approved.",
        );
      }

      return mentorshipResponse(
        res,
        409,
        "A request already exists for this mentor. Please contact them if you need to try again.",
      );
    }

    const request = {
      mentorEmail,
      menteeEmail,
      menteeName: mentee.name || menteeEmail.split("@")[0],
      mentorName: mentor.name || mentorEmail.split("@")[0],
      message,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await mentorRequestsCollection.insertOne(request);

    return res.status(201).json({
      success: true,
      message: "Mentorship request sent successfully.",
      data: { ...request, id: String(result.insertedId) },
    });
  } catch (error) {
    // Protect against a duplicate request if two requests arrive together.
    if (error.code === 11000) {
      return mentorshipResponse(res, 409, "A request already exists.");
    }

    console.error("Create mentorship request:", error);
    return mentorshipResponse(res, 500, "Could not send mentorship request.");
  }
});

// PATCH: Mentor approves or rejects a mentorship request
app.patch("/api/mentorship/requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, mentorEmail } = req.body;

    // Validate request ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid mentorship request ID.",
      });
    }

    // Validate status
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected.",
      });
    }

    if (!mentorEmail) {
      return res.status(400).json({
        success: false,
        message: "Mentor email is required.",
      });
    }

    // Find mentorship request
    const request = await mentorRequestsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Mentorship request not found.",
      });
    }

    // Ensure the request belongs to this mentor
    if (request.mentorEmail?.toLowerCase() !== mentorEmail.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to manage this request.",
      });
    }

    // Ensure the request is still pending
    if (request.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: `This request has already been ${request.status}.`,
      });
    }

    // Find mentor
    const mentor = await userCollection.findOne({
      email: {
        $regex: `^${mentorEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
      role: "mentor",
    });

    if (!mentor) {
      return res.status(404).json({
        success: false,
        message: "Mentor not found.",
      });
    }

    // Reject request
    if (status === "rejected") {
      const rejection = await mentorRequestsCollection.updateOne(
        {
          _id: request._id,
          status: "pending",
        },
        {
          $set: {
            status: "rejected",
            updatedAt: new Date(),
          },
        },
      );

      if (rejection.modifiedCount !== 1) {
        return res.status(409).json({
          success: false,
          message: "This request has already been processed.",
        });
      }

      return res.json({
        success: true,
        message: "Mentorship request rejected successfully.",
      });
    }

    // Get allowed mentor capacity
    const capacity = mentorCapacityOptions.includes(
      Number(mentor.menteeCapacity),
    )
      ? Number(mentor.menteeCapacity)
      : 15;

    // Count currently approved requests
    const approvedCount = await mentorRequestsCollection.countDocuments({
      mentorEmail: request.mentorEmail,
      status: "approved",
    });

    // Initialize missing counters for older mentor records
    await userCollection.updateOne(
      {
        _id: mentor._id,
        activeMenteeCount: { $exists: false },
      },
      {
        $set: {
          activeMenteeCount: approvedCount,
          menteeCapacity: capacity,
        },
      },
    );

    // Read the latest mentor record
    const refreshedMentor = await userCollection.findOne({
      _id: mentor._id,
      role: "mentor",
    });

    if (!refreshedMentor) {
      return res.status(404).json({
        success: false,
        message: "Mentor not found.",
      });
    }

    const effectiveCapacity = mentorCapacityOptions.includes(
      Number(refreshedMentor.menteeCapacity),
    )
      ? Number(refreshedMentor.menteeCapacity)
      : capacity;

    // Check capacity
    if (approvedCount >= effectiveCapacity) {
      return res.status(409).json({
        success: false,
        message: `Mentor capacity is full (${effectiveCapacity} mentees).`,
      });
    }

    // Atomically reserve one mentor slot
    const capacityUpdate = await userCollection.updateOne(
      {
        _id: refreshedMentor._id,
        role: "mentor",
        $expr: {
          $lt: [
            { $ifNull: ["$activeMenteeCount", 0] },
            { $ifNull: ["$menteeCapacity", 15] },
          ],
        },
      },
      {
        $inc: {
          activeMenteeCount: 1,
        },
        $set: {
          updatedAt: new Date(),
        },
      },
    );

    if (capacityUpdate.modifiedCount !== 1) {
      return res.status(409).json({
        success: false,
        message: "Mentor capacity is full. Please refresh and try again.",
      });
    }

    // Approve only if the request is still pending
    const approval = await mentorRequestsCollection.updateOne(
      {
        _id: request._id,
        status: "pending",
      },
      {
        $set: {
          status: "approved",
          updatedAt: new Date(),
        },
      },
    );

    // If approval failed, release the reserved slot
    if (approval.modifiedCount !== 1) {
      await userCollection.updateOne(
        {
          _id: refreshedMentor._id,
          activeMenteeCount: { $gt: 0 },
        },
        {
          $inc: {
            activeMenteeCount: -1,
          },
          $set: {
            updatedAt: new Date(),
          },
        },
      );

      return res.status(409).json({
        success: false,
        message: "This request has already been processed.",
      });
    }

    // Assign the approved mentor to the developer
    const menteeEmail = normalizeEmail(
      request.menteeEmail || request.studentEmail,
    );

    if (menteeEmail) {
      await userCollection.updateOne(
        { email: menteeEmail },
        {
          $set: {
            mentorEmail: normalizeEmail(refreshedMentor.email),
            assignedMentorEmail: normalizeEmail(refreshedMentor.email),
            updatedAt: new Date(),
          },
        },
      );
    }
    return res.json({
      success: true,
      message: "Mentorship request approved successfully.",
      data: {
        requestId: request._id,
        status: "approved",
        mentorEmail: refreshedMentor.email,
        activeMenteeCount: Number(refreshedMentor.activeMenteeCount ?? 0) + 1,
        menteeCapacity: effectiveCapacity,
      },
    });
  } catch (error) {
    console.error("Mentorship request update error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update mentorship request.",
    });
  }
});

// PUT: mentor sets their own capacity to 15 or 20
app.put("/api/mentorship/capacity", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.body.mentorEmail);
    const capacity = Number(req.body.capacity);

    if (!mentorEmail || !mentorCapacityOptions.includes(capacity)) {
      return mentorshipResponse(
        res,
        400,
        "Provide mentorEmail and a capacity of 15 or 20.",
      );
    }

    const mentor = await getMentorByEmail(mentorEmail);

    if (!mentor) {
      return mentorshipResponse(res, 403, "Mentor account not found.");
    }

    const activeCount = await mentorRequestsCollection.countDocuments({
      mentorEmail,
      status: "approved",
    });

    if (capacity < activeCount) {
      return mentorshipResponse(
        res,
        409,
        `Capacity cannot be below your ${activeCount} current mentees.`,
      );
    }

    await userCollection.updateOne(
      { _id: mentor._id },
      {
        $set: {
          menteeCapacity: capacity,
          activeMenteeCount: activeCount,
          updatedAt: new Date(),
        },
      },
    );

    return res.json({
      success: true,
      message: `Mentee capacity set to ${capacity}.`,
      data: { capacity, activeMentees: activeCount },
    });
  } catch (error) {
    console.error("Update mentor capacity:", error);
    return mentorshipResponse(res, 500, "Could not update capacity.");
  }
});

// 22.GET mentor availability
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

    const availability = await mentorAvailabilityCollection.findOne({
      mentorEmail,
    });

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

//23. CREATE OR UPDATE mentor availability
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

    if (!Array.isArray(weeklySchedule) || !Array.isArray(blockedDates)) {
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
        Number(slot.endTime.slice(3, 5)) < 60,
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
      blockedDates: blockedDates.filter((date) =>
        /^\d{4}-\d{2}-\d{2}$/.test(date),
      ),
      updatedAt: new Date(),
    };

    await mentorAvailabilityCollection.updateOne(
      { mentorEmail },
      {
        $set: document,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
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

//24. GET mentor's sessions
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

//25. CREATE a session
app.post("/api/mentor/sessions", async (req, res) => {
  try {
    const mentorEmail = normalizeEmail(req.body.mentorEmail);
    const menteeEmail = normalizeEmail(req.body.menteeEmail);

    const { title, description, startAt, endAt, meetingLink } = req.body;

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
      }),
    ]);

    if (!mentor) {
      return res.status(403).json({
        message: "Only mentors can create sessions.",
      });
    }

    if (!mentee) {
      console.log("Mentee email searched:", menteeEmail);

      return res.status(404).json({
        message:
          "No user found with this email. Check the email field and registered account.",
      });
    }

    console.log("Matched mentee account:", {
      email: mentee.email,
      role: mentee.role,
      name: mentee.name,
    });

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
      description: String(description || "")
        .trim()
        .slice(0, 2000),
      startAt: start,
      endAt: end,
      meetingLink: String(meetingLink || "")
        .trim()
        .slice(0, 1000),
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

//26 UPDATE session status, meeting link, notes, or action items
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
      updates.meetingLink = String(req.body.meetingLink).trim().slice(0, 1000);
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
          !item.dueDate || /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate);

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
      { $set: updates },
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

app.get("/api/developer/sessions", async (req, res) => {
  try {
    const menteeEmail = normalizeEmail(req.query.menteeEmail);

    if (!menteeEmail) {
      return res.status(400).json({
        message: "Developer email is required.",
      });
    }

    const sessions = await mentorSessionsCollection
      .find({ menteeEmail })
      .sort({ startAt: 1 })
      .limit(200)
      .toArray();

    return res.status(200).json({ sessions });
  } catch (error) {
    console.error("Get developer sessions:", error);

    return res.status(500).json({
      message: "Failed to load developer sessions.",
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
