const { supabase } = require("../_lib/supabase");
const { sendJson, methodNotAllowed } = require("../_lib/http");

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

  return sendJson(res, 200, {
    ok: true,
    applications: data || []
  });
};
