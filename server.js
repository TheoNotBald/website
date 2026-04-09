require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = Number(process.env.PORT || 444);
const HOST = process.env.HOST || "0.0.0.0";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-env";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const OAUTH_READY = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL);

// Log staff/manager IDs at startup
console.log(`[STARTUP] STAFF_DISCORD_IDS=${process.env.STAFF_DISCORD_IDS || "(not set)"}`);
console.log(`[STARTUP] MANAGER_DISCORD_IDS=${process.env.MANAGER_DISCORD_IDS || "(not set)"}`);
console.log(`[STARTUP] DISCORD_CLIENT_ID set=${Boolean(DISCORD_CLIENT_ID)}`);
console.log(`[STARTUP] DISCORD_CLIENT_SECRET set=${Boolean(DISCORD_CLIENT_SECRET)}`);
console.log(`[STARTUP] DISCORD_CALLBACK_URL=${DISCORD_CALLBACK_URL || "(not set)"}`);
console.log(`[STARTUP] OAUTH_READY=${OAUTH_READY}`);
console.log(`[STARTUP] SUPABASE_ENABLED=${SUPABASE_ENABLED}`);
const MINIMUM_AGE = 13;
const RESUBMIT_LOCK_MS = 24 * 60 * 60 * 1000;
const APPLICATION_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const PROFANITY_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "cunt",
  "pussy",
  "whore",
  "slut"
];
const SCORE_FIELD_KEYS = [
  "aboutYourself",
  "eventGoals",
  "pastEventExperience",
  "characterDescription",
  "failureStory",
  "scenarioPiratesCornerYou",
  "scenarioStrandedSailors"
];
const APPLICATION_FIELD_LABELS = {
  ign: "IGN",
  discordUser: "Discord user",
  discordUid: "Discord UID",
  age: "Age",
  timezone: "Timezone",
  preferredSide: "Preferred side",
  hasMicrophone: "Working microphone",
  streamingInfo: "Streaming/recording info",
  aboutYourself: "About yourself",
  eventGoals: "Event goals",
  pastEventExperience: "Past event experience",
  characterDescription: "Character description",
  failureStory: "Failure story",
  scenarioPiratesCornerYou: "Scenario: pirates corner you",
  scenarioStrandedSailors: "Scenario: stranded sailors"
};
const APPLICATION_PAGE_FIELDS = {
  1: ["ign", "discordUser", "discordUid", "age", "timezone"],
  2: ["preferredSide", "hasMicrophone", "streamingInfo"],
  3: ["aboutYourself", "eventGoals", "pastEventExperience", "characterDescription", "failureStory"],
  4: ["scenarioPiratesCornerYou", "scenarioStrandedSailors"]
};
const APPLICATION_ALL_FIELDS = Object.values(APPLICATION_PAGE_FIELDS).flat();

const storePath = path.join(__dirname, "data", "store.json");
let supabaseClient = null;

function getSupabaseClient() {
  if (!SUPABASE_ENABLED) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return supabaseClient;
}

async function insertSupabaseApplication(application) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const payload = {
    discord_id: application.discordId,
    ign: application.answers?.ign || "Unknown",
    preferred_side: application.answers?.preferredSide || "Unknown",
    status: application.status || "pending",
    answers: application.answers || {},
    archived: Boolean(application.archived),
    created_at: application.createdAt,
    updated_at: application.updatedAt
  };

  const { data, error } = await supabase
    .from("applications")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Supabase application insert failed: ${error.message}`);
  }

  return data?.id || null;
}

async function updateSupabaseApplicationStatus(application, updates = {}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  let supabaseId = application.supabaseId || null;
  if (!supabaseId) {
    supabaseId = await insertSupabaseApplication(application);
    if (supabaseId) {
      application.supabaseId = supabaseId;
    }
  }

  const payload = {
    status: application.status,
    archived: Boolean(application.archived),
    answers: application.answers || {},
    updated_at: application.updatedAt || new Date().toISOString(),
    ...updates
  };

  const { error } = await supabase
    .from("applications")
    .update(payload)
    .eq("id", supabaseId);

  if (error) {
    throw new Error(`Supabase application update failed: ${error.message}`);
  }
}

async function insertSupabaseManagerLog(entry) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const payload = {
    action: entry.action,
    application_id: entry.applicationId,
    minecraft_username: entry.minecraftUsername || null,
    actor_discord_id: entry.actorId || null,
    actor_name: entry.actorName || null,
    actor_alias: entry.actorAlias || null,
    reason: entry.reason || null,
    created_at: entry.at || new Date().toISOString()
  };

  const { error } = await supabase
    .from("manager_logs")
    .insert(payload);

  if (error) {
    throw new Error(`Supabase manager log insert failed: ${error.message}`);
  }
}

function getApplicationTimestamp(application) {
  return new Date(application.createdAt || application.updatedAt || 0).getTime();
}

function pruneExpiredApplications(data) {
  const now = Date.now();
  const originalLength = Array.isArray(data.applications) ? data.applications.length : 0;
  data.applications = (data.applications || []).filter((application) => {
    const ts = getApplicationTimestamp(application);
    return Number.isFinite(ts) && now - ts < APPLICATION_RETENTION_MS;
  });
  return data.applications.length !== originalLength;
}

function pruneLegacyApplications(data) {
  const requiredAnswerFields = [
    "ign",
    "aboutYourself",
    "eventGoals",
    "pastEventExperience",
    "characterDescription",
    "failureStory",
    "scenarioPiratesCornerYou",
    "scenarioStrandedSailors"
  ];

  const originalLength = Array.isArray(data.applications) ? data.applications.length : 0;
  data.applications = (data.applications || []).filter((application) => {
    const answers = application && application.answers ? application.answers : null;
    if (!answers) {
      return false;
    }

    return requiredAnswerFields.every((field) => {
      const value = (answers[field] || "").toString().trim();
      return value.length > 0;
    });
  });

  return data.applications.length !== originalLength;
}

function readStore() {
  const raw = fs.readFileSync(storePath, "utf8");
  const data = JSON.parse(raw);
  data.users = data.users || {};
  data.applications = Array.isArray(data.applications) ? data.applications : [];
  data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
  const didPrune = pruneExpiredApplications(data);
  const didPruneLegacy = pruneLegacyApplications(data);
  if (didPrune || didPruneLegacy) {
    writeStore(data);
  }
  return data;
}

function writeStore(data) {
  try {
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
  } catch (error) {
    const code = error && error.code ? error.code : "UNKNOWN";
    const isReadOnlyFs = ["EROFS", "EPERM", "EACCES"].includes(code);

    if (isReadOnlyFs) {
      // Vercel serverless runtime does not allow writing to deployed source files.
      console.warn(`[WARN] Skipping writeStore on read-only filesystem (${code}).`);
      return;
    }

    throw error;
  }
}

function parseIdList(value) {
  return new Set(
    (value || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function appendAuditLog(data, entry) {
  data.auditLog = Array.isArray(data.auditLog) ? data.auditLog : [];
  data.auditLog.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...entry
  });
}

function getManagerLogs(data) {
  return (data.auditLog || [])
    .filter((item) => ["accepted", "denied", "deleted"].includes(item.action))
    .slice()
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((item) => ({
      ...item,
      actorName: item.actorId ? getDisplayName(data.users[item.actorId] || {}) : "Unknown User"
    }));
}

function staffIds() {
  const ids = parseIdList(process.env.STAFF_DISCORD_IDS);
  if (ids.size === 0) {
    console.warn("[WARN] STAFF_DISCORD_IDS env var is empty or not set!");
  }
  return ids;
}

function managerIds() {
  const ids = parseIdList(process.env.MANAGER_DISCORD_IDS);
  if (ids.size === 0) {
    console.warn("[WARN] MANAGER_DISCORD_IDS env var is empty or not set!");
  }
  return ids;
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

if (DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL) {
  passport.use(
    new DiscordStrategy(
      {
        clientID: DISCORD_CLIENT_ID,
        clientSecret: DISCORD_CLIENT_SECRET,
        callbackURL: DISCORD_CALLBACK_URL,
        scope: ["identify"]
      },
      (accessToken, refreshToken, profile, done) => done(null, profile)
    )
  );
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

function ensureSignedIn(req, res, next) {
  if (!req.isAuthenticated() || !req.session.portal) {
    return res.redirect("/");
  }
  next();
}

function ensurePortal(...allowedPortals) {
  return (req, res, next) => {
    if (!req.session.portal || !allowedPortals.includes(req.session.portal)) {
      return res.status(403).send("Access denied.");
    }
    next();
  };
}

function nextApplicationId(applications) {
  if (!applications.length) {
    return 1;
  }
  return Math.max(...applications.map((item) => item.id)) + 1;
}

function updateUserFromProfile(profile) {
  const data = readStore();
  data.users[profile.id] = {
    id: profile.id,
    username: profile.username,
    discriminator: profile.discriminator,
    globalName: profile.global_name || null,
    avatar: profile.avatar || null,
    lastLoginAt: new Date().toISOString()
  };
  writeStore(data);
}

function getDisplayName(user) {
  return user.globalName || user.username || "Unknown User";
}

function createLocalProfile(portal, username) {
  return {
    id: `local-${portal}-${username}`,
    username,
    discriminator: "0000",
    global_name: `${portal.charAt(0).toUpperCase() + portal.slice(1)} ${username}`,
    avatar: null
  };
}

function mapApplicationForDisplay(item, users) {
  const applicant = users[item.discordId] || {};
  const reviewer = item.reviewedBy ? users[item.reviewedBy] || {} : null;
  const staffReviews = (item.staffReviews || []).map((review) => {
    const staffUser = review.staffId ? users[review.staffId] || {} : {};
    return {
      ...review,
      staffDisplayName: review.staffAlias || getDisplayName(staffUser)
    };
  });

  const computedAverage = calculateAverageScore(item.questionScores || []);
  const quickRating = Number(item.staffQuickRating);

  return {
    ...item,
    applicantName: getDisplayName(applicant),
    reviewerName: reviewer ? getDisplayName(reviewer) : null,
    staffReviews,
    averageScore: computedAverage !== null ? computedAverage : (Number.isFinite(quickRating) ? quickRating : null),
    scoreSubmissionCount: (item.questionScores || []).length
  };
}

function calculateAverageScore(questionScores) {
  const values = (questionScores || [])
    .filter((submission) => submission.reviewerPortal === "staff")
    .flatMap((submission) => SCORE_FIELD_KEYS.map((key) => Number(submission.scores?.[key])))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

function parseScorePayload(body) {
  const scores = {};
  const invalidFields = [];

  for (const key of SCORE_FIELD_KEYS) {
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < 0 || value > 5) {
      invalidFields.push(key);
      continue;
    }
    scores[key] = value;
  }

  return { scores, invalidFields };
}

function applicationSortRank(status) {
  if (status === "under_review") {
    return -1;
  }
  return status === "accepted" || status === "denied" ? 1 : 0;
}

function containsProfanity(value) {
  const normalized = (value || "")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  return PROFANITY_WORDS.some((word) => {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    return pattern.test(normalized);
  });
}

function hasAnyProfanity(values) {
  return values.some((value) => containsProfanity(value));
}

function getProfanityFields(payload) {
  return Object.entries(payload)
    .filter(([key]) => !["age"].includes(key))
    .filter(([, value]) => containsProfanity(value))
    .map(([key]) => key);
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function hashIp(ip) {
  return crypto.createHash("sha256").update(`${SESSION_SECRET}:${ip}`).digest("hex");
}

function isWithinLockWindow(isoTime) {
  const ts = new Date(isoTime).getTime();
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts < RESUBMIT_LOCK_MS;
}

function normalizeApplicationPayload(raw = {}) {
  return {
    ign: (raw.ign || "").toString().trim(),
    discordUser: (raw.discordUser || "").toString().trim(),
    discordUid: (raw.discordUid || "").toString().trim(),
    age: Number(raw.age || 0),
    timezone: (raw.timezone || "").toString().trim(),
    preferredSide: (raw.preferredSide || "").toString().trim(),
    hasMicrophone: (raw.hasMicrophone || "").toString().trim(),
    streamingInfo: (raw.streamingInfo || "").toString().trim(),
    aboutYourself: (raw.aboutYourself || "").toString().trim(),
    eventGoals: (raw.eventGoals || "").toString().trim(),
    pastEventExperience: (raw.pastEventExperience || "").toString().trim(),
    characterDescription: (raw.characterDescription || "").toString().trim(),
    failureStory: (raw.failureStory || "").toString().trim(),
    scenarioPiratesCornerYou: (raw.scenarioPiratesCornerYou || "").toString().trim(),
    scenarioStrandedSailors: (raw.scenarioStrandedSailors || "").toString().trim()
  };
}

function sanitizeDraftFields(raw = {}) {
  const normalized = normalizeApplicationPayload(raw);
  const sanitized = {};
  for (const key of APPLICATION_ALL_FIELDS) {
    sanitized[key] = normalized[key];
  }
  return sanitized;
}

function parseFormPage(value) {
  const parsed = Number.parseInt((value || "1").toString(), 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(4, parsed));
}

async function sendDiscordDM(userId, content) {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is not configured.");
  }

  const channelRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ recipient_id: userId })
  });

  if (!channelRes.ok) {
    const details = await channelRes.text();
    throw new Error(`Failed to create DM channel (${channelRes.status}): ${details}`);
  }

  const channel = await channelRes.json();

  const messageRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!messageRes.ok) {
    const details = await messageRes.text();
    throw new Error(`Failed to send DM message (${messageRes.status}): ${details}`);
  }
}

function acceptedMessage(ign, averageScore) {
  return [
    "Hello! Your Starfall event application has been reviewed.",
    `Status: ACCEPTED for ${ign}.`,
    `Final Average Score: ${averageScore ?? "N/A"}/5`,
    "A manager will follow up with event details and next steps."
  ].join("\n");
}

function deniedMessage(ign, averageScore) {
  return [
    "Hello! Your Starfall event application has been reviewed.",
    `Status: DENIED for ${ign}.`,
    `Final Average Score: ${averageScore ?? "N/A"}/5`,
    "Thank you for applying. You can apply for future events."
  ].join("\n");
}

function underReviewMessage(ign) {
  return [
    "Hello! Quick update on your Starfall event application.",
    `Status: UNDER REVIEW for ${ign}.`,
    "Your event application is currently being reviewed by the application team."
  ].join("\n");
}

app.get("/", (req, res) => {
  res.render("login", {
    user: req.user,
    portal: req.session.portal || null
  });
});

app.get("/login/applicant", (req, res) => {
  res.render("applicant-login");
});

// Legacy path aliases kept for backward compatibility with old links.
app.get("/applicant-login", (req, res) => {
  res.redirect("/login/applicant");
});

app.get("/portal-login/staff", (req, res) => {
  res.redirect("/login/staff");
});

app.get("/portal-login/manager", (req, res) => {
  res.redirect("/login/manager");
});

app.get("/login/:portal", (req, res) => {
  const portal = req.params.portal;
  if (!["staff", "manager"].includes(portal)) {
    return res.status(404).send("Login page not found.");
  }

  return res.render("portal-login", {
    portal,
    error: req.query.error || null
  });
});

app.post("/login/:portal", (req, res) => {
  const portal = req.params.portal;
  return res.status(405).send("Password login is no longer supported. Please use Discord OAuth.");
});

app.get("/auth/discord", (req, res, next) => {
  if (!passport._strategy("discord")) {
    return res.status(500).send("Discord OAuth is not configured. Check your .env settings.");
  }

  const portal = (req.query.portal || "applicant").toString();
  console.log(`[DEBUG] /auth/discord: query.portal=${req.query.portal}, normalized portal=${portal}`);
  if (!["applicant", "staff", "manager"].includes(portal)) {
    return res.status(400).send("Invalid portal.");
  }

  req.session.requestedPortal = portal;
  console.log(`[DEBUG] Set session.requestedPortal to: ${portal}`);
  req.session.save((err) => {
    if (err) {
      return next(err);
    }
    passport.authenticate("discord", { state: portal })(req, res, next);
  });
});

app.get(
  "/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    const statePortal = (req.query.state || "").toString();
    const sessionPortal = (req.session.requestedPortal || "").toString();
    const validPortals = ["applicant", "staff", "manager"];
    const requestedPortal = validPortals.includes(statePortal)
      ? statePortal
      : (validPortals.includes(sessionPortal) ? sessionPortal : null);
    const userId = req.user.id;

    const isManager = managerIds().has(userId);
    const isStaff = staffIds().has(userId) || isManager;

    console.log(`[DEBUG] Callback: userId=${userId}, statePortal=${statePortal || "(none)"}, sessionPortal=${sessionPortal || "(none)"}, requestedPortal=${requestedPortal || "(none)"}, isStaff=${isStaff}, isManager=${isManager}`);

    if (requestedPortal === "manager" && !isManager) {
      req.logout(() => {
        res.status(403).send("You are not authorized for the manager portal.");
      });
      return;
    }

    if (requestedPortal === "staff" && !isStaff) {
      req.logout(() => {
        res.status(403).send("You are not authorized for the staff portal.");
      });
      return;
    }

    // Honor explicit requested portal. Only infer by role when context is truly missing.
    let finalPortal = requestedPortal;
    if (!finalPortal && isManager) {
      finalPortal = "manager";
    } else if (!finalPortal && isStaff) {
      finalPortal = "staff";
    } else if (!finalPortal) {
      finalPortal = "applicant";
    }

    req.session.portal = finalPortal;
    console.log(`[DEBUG] Setting session.portal to: ${finalPortal}`);
    updateUserFromProfile(req.user);
    res.redirect("/dashboard");
  }
);

app.get("/dashboard", ensureSignedIn, (req, res) => {
  const data = readStore();
  const portal = req.session.portal;
  const persistedUser = data.users[req.user.id] || null;
  const user = persistedUser || {
    id: req.user.id,
    username: req.user.username || null,
    globalName: req.user.globalName || req.user.global_name || null,
    avatar: req.user.avatar || null
  };
  const reviewerId = req.user.id;
  console.log(`[DEBUG] Dashboard: portal=${portal}, userId=${req.user.id}, isAuthenticated=${req.isAuthenticated()}`);
  console.log(`[DEBUG] Session portal value: ${JSON.stringify(req.session.portal)}`);
  const searchQuery = (req.query.search || "").toString().trim();
  const sideFilterRaw = (req.query.side || "").toString().trim().toLowerCase();
  const managerTabValues = ["pirates", "sailors", "pirates_unscored", "sailors_unscored", "accepted", "denied"];
  const selectedSideFilter = portal === "manager"
    ? (managerTabValues.includes(sideFilterRaw) ? sideFilterRaw : "pirates")
    : (["pirates", "sailors"].includes(sideFilterRaw) ? sideFilterRaw : "");
  const requestedPage = Number.parseInt((req.query.page || "1").toString(), 10);
  const pageSize = 1;

  if (portal === "applicant") {
    const application = data.applications.find((item) => item.discordId === req.user.id) || null;
    const draftApplication = req.session.applicationDraft || null;
    const applicantFormPage = parseFormPage(req.query.formPage);
    const profanityFieldKeys = req.session.profanityFieldKeys || [];
    const profanityFieldLabels = (req.session.profanityFieldLabels || []).slice();

    return res.render("dashboard", {
      portal,
      user,
      application,
      draftApplication,
      applicantFormPage,
      profanityFieldKeys,
      profanityFieldLabels,
      searchQuery: "",
      selectedSideFilter: "",
      sideCounts: {
        pirates: 0,
        sailors: 0
      },
      staffRemainingTotal: 0,
      currentPage: 1,
      totalPages: 1,
      totalResults: 0,
      managerLogs: [],
      applications: [],
      notice: req.query.notice || null,
      error: req.query.error || null
    });
  }

  const baseApplications = data.applications
    .filter((item) => !item.archived)
    .filter((item) => {
      if (portal !== "staff") {
        return true;
      }
      if (["accepted", "denied"].includes(item.status)) {
        return false;
      }
      const reviewerSubmissionCount = (item.questionScores || []).filter(
        (submission) => submission.reviewerPortal === "staff" && submission.reviewerId === reviewerId
      ).length;
      return reviewerSubmissionCount < 1;
    })
    .slice();

  const staffRemainingTotal = portal === "staff" ? baseApplications.length : 0;

  const isScoredApplication = (item) => {
    const hasStaffScores = (item.questionScores || []).some(
      (submission) => submission.reviewerPortal === "staff"
    );
    const quickRating = Number(item.staffQuickRating);
    return hasStaffScores || Number.isFinite(quickRating);
  };

  const searchScopedApplications = baseApplications
    .filter((item) => {
      if (!searchQuery) {
        return true;
      }
      return (item.answers?.ign || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
    });

  const sideCounts = searchScopedApplications.reduce(
    (acc, item) => {
      const side = (item.answers?.preferredSide || "").toLowerCase();
      const scored = isScoredApplication(item);
      const status = (item.status || "").toLowerCase();
      const isFinalized = status === "accepted" || status === "denied";

      if (portal === "manager") {
        if (status === "accepted") {
          acc.accepted += 1;
        } else if (status === "denied") {
          acc.denied += 1;
        }
        if (side === "pirates" && scored && !isFinalized) {
          acc.pirates += 1;
        } else if (side === "sailors" && scored && !isFinalized) {
          acc.sailors += 1;
        }
        if (side === "pirates" && !scored && !isFinalized) {
          acc.piratesUnscored += 1;
        } else if (side === "sailors" && !scored && !isFinalized) {
          acc.sailorsUnscored += 1;
        }
        return acc;
      }

      if (side === "pirates") {
        acc.pirates += 1;
      } else if (side === "sailors") {
        acc.sailors += 1;
      }
      return acc;
    },
    { pirates: 0, sailors: 0, piratesUnscored: 0, sailorsUnscored: 0, accepted: 0, denied: 0 }
  );

  const filteredApplications = searchScopedApplications
    .filter((item) => {
      if (portal !== "manager") {
        if (!selectedSideFilter) {
          return true;
        }
        return (item.answers?.preferredSide || "").toLowerCase() === selectedSideFilter;
      }
      const side = (item.answers?.preferredSide || "").toLowerCase();
      const scored = isScoredApplication(item);
      const status = (item.status || "").toLowerCase();
      const isFinalized = status === "accepted" || status === "denied";

      if (selectedSideFilter === "pirates") {
        return side === "pirates" && scored && !isFinalized;
      }
      if (selectedSideFilter === "sailors") {
        return side === "sailors" && scored && !isFinalized;
      }
      if (selectedSideFilter === "pirates_unscored") {
        return side === "pirates" && !scored && !isFinalized;
      }
      if (selectedSideFilter === "sailors_unscored") {
        return side === "sailors" && !scored && !isFinalized;
      }
      if (selectedSideFilter === "accepted") {
        return status === "accepted";
      }
      if (selectedSideFilter === "denied") {
        return status === "denied";
      }

      return side === "pirates" && scored && !isFinalized;
    })
    .slice()
    .sort((a, b) => {
      const rankDiff = applicationSortRank(a.status) - applicationSortRank(b.status);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      if (portal === "manager" && a.status === "under_review" && b.status === "under_review") {
        const aScores = (a.questionScores || []).filter((submission) => submission.reviewerPortal === "staff").length;
        const bScores = (b.questionScores || []).filter((submission) => submission.reviewerPortal === "staff").length;
        const scoreDiff = aScores - bScores;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
      }

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    })
    .map((item) => mapApplicationForDisplay(item, data.users));

  const totalResults = filteredApplications.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, totalPages)
    : 1;
  const startIndex = (currentPage - 1) * pageSize;
  const applications = filteredApplications.slice(startIndex, startIndex + pageSize);

  return res.render("dashboard", {
    portal,
    user,
    application: null,
    draftApplication: null,
    profanityFieldKeys: [],
    profanityFieldLabels: [],
    searchQuery,
    selectedSideFilter,
    sideCounts,
    staffRemainingTotal,
    currentPage,
    totalPages,
    totalResults,
    applications,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

app.get("/applications/:id/review", ensureSignedIn, ensurePortal("staff", "manager"), (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const application = data.applications.find((item) => item.id === id && !item.archived);

  if (!application) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  const mapped = mapApplicationForDisplay(application, data.users);
  const user = data.users[req.user.id];
  const existingScore = (application.questionScores || []).find(
    (submission) => submission.reviewerId === req.user.id
  );
  const scoreSubmissions = (application.questionScores || []).map((submission) => {
    const reviewerUser = submission.reviewerId ? data.users[submission.reviewerId] || {} : {};
    const numericScores = SCORE_FIELD_KEYS
      .map((key) => Number(submission.scores?.[key]))
      .filter((value) => Number.isFinite(value));
    const overallAverage = numericScores.length
      ? Number((numericScores.reduce((sum, value) => sum + value, 0) / numericScores.length).toFixed(2))
      : null;

    return {
      ...submission,
      staffDisplayName: submission.reviewerAlias || getDisplayName(reviewerUser),
      overallAverage
    };
  });
  const appForView = {
    ...mapped,
    scoreSubmissions
  };

  return res.render("application-review", {
    portal: req.session.portal,
    user,
    app: appForView,
    entry: appForView,
    searchQuery: (req.query.search || "").toString().trim(),
    scoreKeys: SCORE_FIELD_KEYS,
    existingScore: existingScore ? existingScore.scores : {},
    overallAverage: mapped.averageScore,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

app.post("/applications/:id/score", ensureSignedIn, ensurePortal("staff"), (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const reviewerAlias = getDisplayName(data.users[req.user.id] || req.user || {}) || "Staff Reviewer";
  const searchQuery = (req.body.searchQuery || "").toString().trim();

  const { scores, invalidFields } = parseScorePayload(req.body);
  if (invalidFields.length) {
    return res.redirect(
      `/applications/${id}/review?search=${encodeURIComponent(searchQuery)}&error=All+question+scores+must+be+between+0+and+5.`
    );
  }

  const application = data.applications.find((item) => item.id === id && !item.archived);
  if (!application) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  application.questionScores = application.questionScores || [];
  const existingIndex = application.questionScores.findIndex(
    (submission) => submission.reviewerId === req.user.id
  );

  const submission = {
    reviewerId: req.user.id,
    reviewerPortal: req.session.portal,
    reviewerAlias,
    scores,
    submittedAt: new Date().toISOString()
  };

  if (existingIndex >= 0) {
    application.questionScores[existingIndex] = submission;
  } else {
    application.questionScores.push(submission);
  }

  application.averageScore = calculateAverageScore(application.questionScores);
  application.updatedAt = new Date().toISOString();
  writeStore(data);

  return res.redirect(
    `/applications/${id}/review?search=${encodeURIComponent(searchQuery)}&notice=Scores+saved+successfully.`
  );
});

app.get("/archives", ensureSignedIn, ensurePortal("manager"), (req, res) => {
  const data = readStore();
  const user = data.users[req.user.id];

  const archives = data.applications
    .filter((item) => item.archived)
    .slice()
    .sort((a, b) => {
      const aTs = new Date(a.archivedAt || a.updatedAt || a.createdAt).getTime();
      const bTs = new Date(b.archivedAt || b.updatedAt || b.createdAt).getTime();
      return bTs - aTs;
    })
    .map((item) => mapApplicationForDisplay(item, data.users));

  return res.render("archives", {
    portal: "manager",
    user,
    archives,
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

app.get("/manager-logs", ensureSignedIn, ensurePortal("manager"), (req, res) => {
  const data = readStore();
  const user = data.users[req.user.id];

  return res.render("manager-logs", {
    portal: "manager",
    user,
    managerLogs: getManagerLogs(data),
    notice: req.query.notice || null,
    error: req.query.error || null
  });
});

async function submitApplicationPayload(req, res, payload, options = {}) {
  const skipRateLimit = options.skipRateLimit === true;
  const data = readStore();
  const existing = data.applications.find((item) => item.discordId === req.user.id);
  const clientIpHash = hashIp(getClientIp(req));
  const ipLocked = data.applications.some(
    (item) => item.ipHash === clientIpHash && isWithinLockWindow(item.createdAt)
  );

  if (!skipRateLimit && ipLocked) {
    return res.redirect("/dashboard?error=You+can+only+submit+one+application+per+IP+every+24+hours.");
  }

  if (!skipRateLimit && existing && isWithinLockWindow(existing.createdAt)) {
    return res.redirect("/dashboard?error=You+must+wait+24+hours+before+submitting+another+application.");
  }

  const missing = Object.entries(payload)
    .filter(([key, value]) => {
      if (["age"].includes(key)) {
        return !Number.isFinite(value) || value <= 0;
      }
      return !value;
    })
    .map(([key]) => key);

  if (missing.length) {
    req.session.applicationDraft = payload;
    const missingLabels = missing.map((key) => APPLICATION_FIELD_LABELS[key] || key);
    return res.redirect(
      `/dashboard?error=${encodeURIComponent(`Please complete these required fields: ${missingLabels.join(", ")}.`)}`
    );
  }

  if (payload.age < MINIMUM_AGE) {
    req.session.applicationDraft = payload;
    return res.redirect(`/dashboard?error=Applicants+must+be+at+least+${MINIMUM_AGE}+years+old.`);
  }

  const profanityFields = getProfanityFields(payload);
  if (profanityFields.length) {
    req.session.applicationDraft = payload;
    req.session.profanityFieldKeys = profanityFields;
    req.session.profanityFieldLabels = profanityFields.map(
      (fieldName) => APPLICATION_FIELD_LABELS[fieldName] || fieldName
    );
    return res.redirect("/dashboard?error=Application+contains+blocked+language.+Please+remove+profanity.");
  }

  req.session.applicationDraft = null;
  req.session.profanityFieldKeys = [];
  req.session.profanityFieldLabels = [];

  const now = new Date().toISOString();

  const newApplication = {
    id: nextApplicationId(data.applications),
    discordId: req.user.id,
    ipHash: clientIpHash,
    status: "pending",
    answers: payload,
    createdAt: now,
    updatedAt: now,
    reviewedBy: null,
    reviewedAt: null
  };

  data.applications.push(newApplication);

  if (SUPABASE_ENABLED) {
    try {
      const supabaseId = await insertSupabaseApplication(newApplication);
      if (supabaseId) {
        newApplication.supabaseId = supabaseId;
      }
    } catch (error) {
      console.error(`[ERROR] ${error.message}`);
      return res.redirect("/dashboard?error=Database+save+failed.+Please+try+again.");
    }
  }

  writeStore(data);
  return res.redirect("/dashboard?notice=Application+submitted+successfully.");
}

app.post("/applications/draft-step", ensureSignedIn, ensurePortal("applicant"), (req, res) => {
  const currentStep = parseFormPage(req.body.currentStep);
  const direction = (req.body.direction || "next").toString();
  const incoming = sanitizeDraftFields(req.body);
  const merged = {
    ...sanitizeDraftFields(req.session.applicationDraft || {}),
    ...incoming
  };

  req.session.applicationDraft = merged;

  if (direction === "next") {
    const missing = APPLICATION_PAGE_FIELDS[currentStep].filter((key) => {
      if (key === "age") {
        return !Number.isFinite(merged.age) || merged.age <= 0;
      }
      return !merged[key];
    });

    if (missing.length) {
      return res.redirect(
        `/dashboard?formPage=${currentStep}&error=Please+complete+all+fields+on+this+page+before+continuing.`
      );
    }

    if (currentStep === 1 && merged.age < MINIMUM_AGE) {
      return res.redirect(`/dashboard?formPage=1&error=Applicants+must+be+at+least+${MINIMUM_AGE}+years+old.`);
    }
  }

  const nextStep = direction === "prev" ? Math.max(1, currentStep - 1) : Math.min(4, currentStep + 1);
  return res.redirect(`/dashboard?formPage=${nextStep}`);
});

app.post("/applications/submit-step", ensureSignedIn, ensurePortal("applicant"), async (req, res) => {
  const incoming = sanitizeDraftFields(req.body);
  const payload = {
    ...sanitizeDraftFields(req.session.applicationDraft || {}),
    ...incoming
  };

  req.session.applicationDraft = payload;
  return submitApplicationPayload(req, res, payload);
});

app.post("/applications", ensureSignedIn, ensurePortal("applicant"), async (req, res) => {
  const payload = normalizeApplicationPayload(req.body);

  return submitApplicationPayload(req, res, payload);
});

function createTestApplicationPayload(preferredSide) {
  const suffix = Date.now().toString().slice(-4);
  const side = preferredSide === "Sailors" ? "Sailors" : "Pirates";
  return {
    ign: `TestUser${suffix}`,
    discordUser: `testuser#${suffix}`,
    discordUid: `10000000000000${suffix}`,
    age: 18,
    timezone: "EST",
    preferredSide: side,
    hasMicrophone: "Yes",
    streamingInfo: "No",
    aboutYourself: "I am a calm and competitive Minecraft player who likes team strategy.",
    eventGoals: "Create good story moments and support my crew.",
    pastEventExperience: "I played in two lore-heavy SMP events with voice roleplay.",
    characterDescription: "A daring quartermaster focused on naval scouting and trade routes.",
    failureStory: "I once overcommitted in a PvP tournament and lost resources; I regrouped and adapted tactics.",
    scenarioPiratesCornerYou: "I negotiate first, protect my team, and avoid pointless escalation while roleplaying the scene.",
    scenarioStrandedSailors: "I would share food and build trust for future diplomacy, unless my faction orders otherwise."
  };
}

app.post("/applications/test", ensureSignedIn, ensurePortal("applicant"), async (req, res) => {
  const payload = createTestApplicationPayload("Pirates");
  return submitApplicationPayload(req, res, payload, { skipRateLimit: true });
});

app.post("/applications/test/pirates", ensureSignedIn, ensurePortal("applicant"), async (req, res) => {
  const payload = createTestApplicationPayload("Pirates");
  return submitApplicationPayload(req, res, payload, { skipRateLimit: true });
});

app.post("/applications/test/sailors", ensureSignedIn, ensurePortal("applicant"), async (req, res) => {
  const payload = createTestApplicationPayload("Sailors");

  return submitApplicationPayload(req, res, payload, { skipRateLimit: true });
});

app.post("/applications/:id/decision", ensureSignedIn, ensurePortal("manager"), async (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const decision = (req.body.decision || "").toString();
  const reviewerAlias = getDisplayName(data.users[req.user.id] || req.user || {}) || "Manager";
  const decisionReason = (req.body.decisionReason || "").trim();

  if (!["accepted", "denied"].includes(decision)) {
    return res.redirect("/dashboard?error=Invalid+decision+value.");
  }

  if (!decisionReason) {
    return res.redirect("/dashboard?error=Decision+explanation+is+required.");
  }

  if (hasAnyProfanity([decisionReason])) {
    return res.redirect("/dashboard?error=Decision+contains+blocked+language.+Please+remove+profanity.");
  }

  const application = data.applications.find((item) => item.id === id);
  if (!application) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  if (["accepted", "denied"].includes(application.status)) {
    return res.redirect("/dashboard?error=This+application+is+already+finalized.+Use+Relook+Application+to+reopen+it.");
  }

  const hasStaffScores = (application.questionScores || []).some(
    (submission) => submission.reviewerPortal === "staff"
  );

  if (!hasStaffScores) {
    return res.redirect("/dashboard?error=At+least+one+score+submission+is+required+before+final+decision.");
  }

  const averageScore = calculateAverageScore(application.questionScores);

  application.status = decision;
  application.reviewedBy = req.user.id;
  application.reviewerAlias = reviewerAlias;
  application.decisionReason = decisionReason;
  application.averageScore = averageScore;
  application.reviewedAt = new Date().toISOString();
  application.updatedAt = application.reviewedAt;
  application.reviewHistory = application.reviewHistory || [];
  application.reviewHistory.push({
    decision,
    reviewerId: req.user.id,
    reviewerAlias,
    decisionReason,
    at: application.reviewedAt
  });

  appendAuditLog(data, {
    action: decision,
    applicationId: application.id,
    minecraftUsername: application.answers.ign,
    actorId: req.user.id,
    actorAlias: reviewerAlias,
    reason: decisionReason
  });

  if (SUPABASE_ENABLED) {
    try {
      await updateSupabaseApplicationStatus(application);
      await insertSupabaseManagerLog({
        action: decision,
        applicationId: application.supabaseId || application.id,
        minecraftUsername: application.answers.ign,
        actorId: req.user.id,
        actorAlias: reviewerAlias,
        reason: decisionReason,
        at: application.reviewedAt
      });
    } catch (error) {
      console.error(`[ERROR] ${error.message}`);
      return res.redirect("/dashboard?error=Decision+saved+locally,+but+database+write+failed.");
    }
  }

  writeStore(data);

  const minecraftName = application.answers.ign;
  const content =
    decision === "accepted"
      ? acceptedMessage(minecraftName, averageScore)
      : deniedMessage(minecraftName, averageScore);

  try {
    await sendDiscordDM(application.discordId, content);
    return res.redirect(`/dashboard?notice=Application+${id}+${decision}+and+DM+sent.`);
  } catch (error) {
    return res.redirect(
      `/dashboard?error=Application+${id}+${decision},+but+DM+failed:+${encodeURIComponent(error.message)}`
    );
  }
});

app.post("/applications/:id/relook", ensureSignedIn, ensurePortal("manager"), (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const relookReason = (req.body.relookReason || "").trim();
  const managerAlias = getDisplayName(data.users[req.user.id] || req.user || {}) || "Manager";

  if (relookReason && hasAnyProfanity([relookReason])) {
    return res.redirect("/dashboard?error=Relook+reason+contains+blocked+language.+Please+remove+profanity.");
  }

  const application = data.applications.find((item) => item.id === id);
  if (!application) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  if (!["accepted", "denied"].includes(application.status)) {
    return res.redirect("/dashboard?error=Only+accepted+or+denied+applications+can+be+reopened.");
  }

  const now = new Date().toISOString();
  application.status = "under_review";
  application.updatedAt = now;
  application.reopenedAt = now;
  application.reopenedBy = req.user.id;
  application.reopenedByAlias = managerAlias;
  application.reopenReason = relookReason || null;
  application.reviewHistory = application.reviewHistory || [];
  application.reviewHistory.push({
    decision: "reopened",
    reviewerId: req.user.id,
    reviewerAlias: managerAlias,
    decisionReason: relookReason || "",
    at: now
  });

  if (SUPABASE_ENABLED) {
    updateSupabaseApplicationStatus(application).catch((error) => {
      console.error(`[WARN] ${error.message}`);
    });
  }

  writeStore(data);
  return res.redirect(`/dashboard?notice=Application+${id}+reopened+for+relook.`);
});

app.post("/applications/:id/under-review", ensureSignedIn, ensurePortal("staff"), async (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const inferredStaffAlias = getDisplayName(data.users[req.user.id] || req.user || {});
  const staffAlias = (req.body.staffAlias || "").trim() || inferredStaffAlias || "Staff Reviewer";
  const staffComment = (req.body.staffComment || "").trim();
  const application = data.applications.find((item) => item.id === id);

  const scores = {};
  const invalidScoreFields = [];
  for (const key of SCORE_FIELD_KEYS) {
    const value = Number(req.body[key]);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      invalidScoreFields.push(key);
    } else {
      scores[key] = value;
    }
  }

  if (invalidScoreFields.length) {
    return res.redirect("/dashboard?error=Please+rate+every+question+from+1+to+5.");
  }

  if (hasAnyProfanity([staffAlias, staffComment])) {
    return res.redirect("/dashboard?error=Staff+review+contains+blocked+language.+Please+remove+profanity.");
  }

  if (!application) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  if (application.status === "accepted" || application.status === "denied") {
    return res.redirect("/dashboard?error=Finalized+applications+cannot+be+set+to+under+review.");
  }

  const scoreValues = SCORE_FIELD_KEYS.map((key) => scores[key]);
  const overallAverage = Number(
    (scoreValues.reduce((sum, value) => sum + value, 0) / SCORE_FIELD_KEYS.length).toFixed(2)
  );

  application.questionScores = application.questionScores || [];
  const reviewerSubmissionCount = application.questionScores.filter(
    (submission) => submission.reviewerPortal === "staff" && submission.reviewerId === req.user.id
  ).length;

  if (reviewerSubmissionCount >= 1) {
    return res.redirect("/dashboard?error=You+have+already+scored+this+application+on+this+account.");
  }

  const scoreSubmission = {
    reviewerId: req.user.id,
    reviewerPortal: "staff",
    reviewerAlias: staffAlias,
    scores,
    submittedAt: new Date().toISOString()
  };

  application.questionScores.push(scoreSubmission);

  application.staffReviews = application.staffReviews || [];
  application.staffReviews.push({
    staffId: req.user.id,
    staffAlias,
    comment: staffComment,
    scores,
    rating: overallAverage,
    overallAverage,
    at: new Date().toISOString()
  });
  application.averageScore = calculateAverageScore(application.questionScores);
  application.staffQuickRating = overallAverage;

  application.status = "under_review";
  application.updatedAt = new Date().toISOString();
  application.lastViewedBy = req.user.id;
  application.lastViewedByAlias = staffAlias;
  application.underReviewBy = req.user.id;
  application.underReviewAt = application.updatedAt;

  if (SUPABASE_ENABLED) {
    try {
      await updateSupabaseApplicationStatus(application);
    } catch (error) {
      console.error(`[ERROR] ${error.message}`);
      return res.redirect("/dashboard?error=Review+saved+locally,+but+database+write+failed.");
    }
  }

  writeStore(data);

  const minecraftName = application.answers.ign;
  const content = underReviewMessage(minecraftName);

  try {
    await sendDiscordDM(application.discordId, content);
    return res.redirect(`/dashboard?notice=Application+${id}+marked+under+review,+ratings+saved,+and+DM+sent.`);
  } catch (error) {
    return res.redirect(
      `/dashboard?error=Application+${id}+marked+under+review+and+ratings+saved,+but+DM+failed:+${encodeURIComponent(error.message)}`
    );
  }
});

app.post("/applications/:id/delete", ensureSignedIn, ensurePortal("manager"), (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const confirmDelete = (req.body.confirmDelete || "").toString();
  const managerAlias = getDisplayName(data.users[req.user.id] || req.user || {}) || "Manager";
  const deleteReason = (req.body.deleteReason || "").trim();

  if (confirmDelete !== "yes") {
    return res.redirect("/dashboard?error=Delete+confirmation+is+required.");
  }

  if (!deleteReason) {
    return res.redirect("/dashboard?error=Delete+reason+is+required.");
  }

  if (hasAnyProfanity([deleteReason])) {
    return res.redirect("/dashboard?error=Delete+details+contain+blocked+language.+Please+remove+profanity.");
  }

  const index = data.applications.findIndex((item) => item.id === id);
  if (index === -1) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  const removed = data.applications[index];
  appendAuditLog(data, {
    action: "deleted",
    applicationId: removed.id,
    minecraftUsername: removed.answers?.ign || "Unknown",
    actorId: req.user.id,
    actorAlias: managerAlias,
    reason: deleteReason
  });

  if (SUPABASE_ENABLED) {
    updateSupabaseApplicationStatus({
      ...removed,
      status: removed.status,
      archived: removed.archived,
      updatedAt: new Date().toISOString(),
      answers: removed.answers,
      supabaseId: removed.supabaseId
    }).catch((error) => {
      console.error(`[WARN] ${error.message}`);
    });

    insertSupabaseManagerLog({
      action: "deleted",
      applicationId: removed.supabaseId || removed.id,
      minecraftUsername: removed.answers?.ign || "Unknown",
      actorId: req.user.id,
      actorAlias: managerAlias,
      reason: deleteReason
    }).catch((error) => {
      console.error(`[WARN] ${error.message}`);
    });
  }

  data.applications.splice(index, 1);
  writeStore(data);
  return res.redirect(`/dashboard?notice=Application+${id}+was+deleted+permanently.`);
});

app.post("/applications/:id/archive", ensureSignedIn, ensurePortal("manager"), (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const application = data.applications.find((item) => item.id === id);

  if (!application) {
    return res.redirect("/dashboard?error=Application+not+found.");
  }

  application.archived = true;
  application.archivedAt = new Date().toISOString();
  application.archivedBy = req.user.id;
  application.updatedAt = application.archivedAt;

  writeStore(data);
  return res.redirect(`/dashboard?notice=Application+${id}+was+archived.`);
});

app.get("/applications/:id/download", ensureSignedIn, ensurePortal("manager"), (req, res) => {
  const data = readStore();
  const id = Number(req.params.id);
  const application = data.applications.find((item) => item.id === id);

  if (!application) {
    return res.status(404).send("Application not found.");
  }

  const applicant = data.users[application.discordId] || {};
  const reviewer = application.reviewedBy ? data.users[application.reviewedBy] || {} : {};

  const payload = {
    id: application.id,
    status: application.status,
    archived: Boolean(application.archived),
    applicant: {
      discordId: application.discordId,
      displayName: getDisplayName(applicant)
    },
    reviewedBy: application.reviewedBy
      ? {
          id: application.reviewedBy,
          displayName: getDisplayName(reviewer),
          alias: application.reviewerAlias || null
        }
      : null,
    decisionReason: application.decisionReason || null,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
    reviewedAt: application.reviewedAt || null,
    archivedAt: application.archivedAt || null,
    answers: application.answers,
    staffReviews: application.staffReviews || [],
    reviewHistory: application.reviewHistory || []
  };

  const filename = `application-${application.id}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
  return res.send(JSON.stringify(payload, null, 2));
});

app.post("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect("/");
    });
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
