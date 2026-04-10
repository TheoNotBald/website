const { supabase } = require("../_lib/supabase");
const { sendJson, methodNotAllowed } = require("../_lib/http");

const APPLICATION_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

const REQUIRED_FIELDS = [
  "ign",
  "discordUser",
  "discordUid",
  "age",
  "timezone",
  "preferredSide",
  "hasMicrophone",
  "streamingInfo",
  "aboutYourself",
  "eventGoals",
  "pastEventExperience",
  "characterDescription",
  "failureStory",
  "scenarioPiratesCornerYou",
  "scenarioStrandedSailors"
];

function normalizePayload(body = {}) {
  return {
    ign: (body.ign || "").toString().trim(),
    discordUser: (body.discordUser || "").toString().trim(),
    discordUid: (body.discordUid || "").toString().trim(),
    age: Number(body.age || 0),
    timezone: (body.timezone || "").toString().trim(),
    preferredSide: (body.preferredSide || "").toString().trim(),
    hasMicrophone: (body.hasMicrophone || "").toString().trim(),
    streamingInfo: (body.streamingInfo || "").toString().trim(),
    aboutYourself: (body.aboutYourself || "").toString().trim(),
    eventGoals: (body.eventGoals || "").toString().trim(),
    pastEventExperience: (body.pastEventExperience || "").toString().trim(),
    characterDescription: (body.characterDescription || "").toString().trim(),
    failureStory: (body.failureStory || "").toString().trim(),
    scenarioPiratesCornerYou: (body.scenarioPiratesCornerYou || "").toString().trim(),
    scenarioStrandedSailors: (body.scenarioStrandedSailors || "").toString().trim()
  };
}

function validatePayload(payload) {
  const missingFields = [];

  for (const field of REQUIRED_FIELDS) {
    const value = payload[field];
    if (field === "age") {
      if (!Number.isFinite(value) || value < 13 || value > 120) {
        missingFields.push(field);
      }
      continue;
    }
    if (!value) {
      missingFields.push(field);
    }
  }

  return missingFields;
}

function isApplicationExpired(row, now = Date.now()) {
  const ts = new Date(row.created_at || row.updated_at || 0).getTime();
  return Number.isFinite(ts) && now - ts >= APPLICATION_RETENTION_MS;
}

async function getActiveApplicationsForDiscord(discordId) {
  const { data, error } = await supabase
    .from("applications")
    .select("id, created_at, updated_at")
    .eq("discord_id", discordId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const rows = data || [];
  const expiredIds = rows.filter(isApplicationExpired).map((row) => row.id);

  if (expiredIds.length) {
    const deleteResult = await supabase
      .from("applications")
      .delete()
      .in("id", expiredIds);

    if (deleteResult.error) {
      throw deleteResult.error;
    }
  }

  return rows.filter((row) => !isApplicationExpired(row));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  const payload = normalizePayload(req.body || {});
  const missingFields = validatePayload(payload);

  if (missingFields.length > 0) {
    return sendJson(res, 400, {
      error: "Missing or invalid required fields.",
      missingFields
    });
  }

  const authDiscordId = (req.headers["x-discord-id"] || "").toString().trim();
  if (authDiscordId && authDiscordId !== payload.discordUid) {
    return sendJson(res, 403, { error: "Discord identity mismatch." });
  }

  try {
    const activeApplications = await getActiveApplicationsForDiscord(payload.discordUid);
    if (activeApplications.length > 0) {
      return sendJson(res, 409, {
        error: "You already have an application on file. Ask a manager to delete it or wait for it to auto-delete after 60 days."
      });
    }
  } catch (error) {
    return sendJson(res, 500, {
      error: "Failed to check existing applications.",
      detail: error.message
    });
  }

  const insertRow = {
    discord_id: payload.discordUid,
    ign: payload.ign,
    preferred_side: payload.preferredSide,
    status: "pending",
    answers: payload
  };

  const { data, error } = await supabase
    .from("applications")
    .insert(insertRow)
    .select("id, discord_id, status, created_at")
    .single();

  if (error) {
    return sendJson(res, 500, {
      error: "Failed to save application.",
      detail: error.message
    });
  }

  return sendJson(res, 201, {
    ok: true,
    application: data
  });
};
