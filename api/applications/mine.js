const { supabase } = require("../_lib/supabase");
const { sendJson, methodNotAllowed } = require("../_lib/http");

const APPLICATION_RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

function isApplicationExpired(row, now = Date.now()) {
  const ts = new Date(row.created_at || row.updated_at || 0).getTime();
  if (!Number.isFinite(ts)) {
    return true;
  }
  return now - ts >= APPLICATION_RETENTION_MS;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  const discordId = (req.query.discordId || req.headers["x-discord-id"] || "").toString().trim();
  if (!discordId) {
    return sendJson(res, 400, { error: "discordId is required." });
  }

  const { data, error } = await supabase
    .from("applications")
    .select("id, status, ign, preferred_side, created_at, updated_at, answers")
    .eq("discord_id", discordId)
    .order("created_at", { ascending: false });

  if (error) {
    return sendJson(res, 500, {
      error: "Failed to load applications.",
      detail: error.message
    });
  }

  const rows = data || [];
  const expiredIds = rows.filter(isApplicationExpired).map((row) => row.id);

  if (expiredIds.length) {
    const deleteResult = await supabase
      .from("applications")
      .delete()
      .in("id", expiredIds);

    if (deleteResult.error) {
      return sendJson(res, 500, {
        error: "Failed to clean up expired applications.",
        detail: deleteResult.error.message
      });
    }
  }

  return sendJson(res, 200, {
    ok: true,
    applications: rows.filter((row) => !isApplicationExpired(row))
  });
};
