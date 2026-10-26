const db = require("./db");

const DEFAULT_USAGE = { channel_id: null, brevoWarnBelowCredits: 60, awsWarnCreditsBelowUsd: 10, checkEveryHours: 6 };

async function fetchBrevo() {
  if (!process.env.BREVO_API_KEY) throw new Error("not configured");
  const res = await fetch("https://api.brevo.com/v3/account", {
    headers: { "api-key": process.env.BREVO_API_KEY, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Brevo API ${res.status}`);
  const { plan = [] } = await res.json();
  const entry = plan.find((p) => p.creditsType === "sendLimit") || plan.find((p) => "credits" in p);
  if (!entry) throw new Error("no credits in Brevo plan");
  return { credits: entry.credits, creditsType: entry.creditsType, planType: entry.type };
}

async function fetchAws() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error("not configured");
  const { CostExplorerClient, GetCostAndUsageCommand } = require("@aws-sdk/client-cost-explorer");
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 864e5).toISOString().slice(0, 10);
  const ce = new CostExplorerClient({ region: "us-east-1" });
  const out = await ce.send(new GetCostAndUsageCommand({
    TimePeriod: { Start: start, End: end },
    Granularity: "MONTHLY",
    Filter: { Dimensions: { Key: "SERVICE", Values: ["Amazon Rekognition"] } },
    Metrics: ["UnblendedCost", "NetUnblendedCost"],
  }));
  const sum = (metric) => out.ResultsByTime.reduce((t, r) => t + Number(r.Total?.[metric]?.Amount || 0), 0);

  let creditsLeftUsd = null;
  try {
    const { FreeTierClient, GetAccountPlanStateCommand } = require("@aws-sdk/client-freetier");
    const plan = await new FreeTierClient({ region: "us-east-1" }).send(new GetAccountPlanStateCommand({}));
    creditsLeftUsd = plan.accountPlanRemainingCredits?.amount ?? null;
  } catch (err) {
    console.error("AWS free-tier credit lookup unavailable:", err.message);
  }
  return { grossUsd: sum("UnblendedCost"), netUsd: sum("NetUnblendedCost"), creditsLeftUsd };
}

// Pure: decides which alerts are due and returns the new de-dup state.
function checkUsage(snapshot, settings, state, now) {
  const alerts = [];
  const next = { ...state };
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);

  if (snapshot.brevo && !snapshot.brevoError) {
    const { credits } = snapshot.brevo;
    if (credits < settings.brevoWarnBelowCredits && state.brevoLowDay !== day) {
      alerts.push(`📉 Brevo is low: ${credits} email credits left (warn below ${settings.brevoWarnBelowCredits}).`);
      next.brevoLowDay = day;
    }
  }

  if (snapshot.aws && !snapshot.awsError) {
    const { creditsLeftUsd, netUsd } = snapshot.aws;
    if (creditsLeftUsd !== null) {
      if (creditsLeftUsd < settings.awsWarnCreditsBelowUsd) {
        if (!state.awsCreditsLow) {
          alerts.push(`📉 AWS credits low: $${creditsLeftUsd.toFixed(2)} left (warn below $${settings.awsWarnCreditsBelowUsd}).`);
          next.awsCreditsLow = true;
        }
      } else {
        next.awsCreditsLow = false;
      }
    }
    if (netUsd > 0 && state.awsPayingMonth !== month) {
      alerts.push(`@here 💸 AWS Rekognition is now being charged: $${netUsd.toFixed(2)} net this month.`);
      next.awsPayingMonth = month;
    }
  }

  return { alerts, state: next };
}

async function runUsageCheck(discord) {
  const snapshot = {};
  try {
    snapshot.brevo = await fetchBrevo();
  } catch (err) {
    snapshot.brevoError = err.message;
  }
  try {
    snapshot.aws = await fetchAws();
  } catch (err) {
    snapshot.awsError = err.message;
  }

  const settings = { ...DEFAULT_USAGE, ...(await db.getSetting("usage")) };
  const { alerts, state } = checkUsage(snapshot, settings, (await db.getSetting("usage_state")) || {}, new Date());
  await db.setSetting("usage_state", state);

  if (alerts.length && settings.channel_id) {
    const channel = await discord.channels.fetch(settings.channel_id);
    for (const text of alerts) await channel.send(text);
  }
  return { snapshot, alerts };
}

module.exports = { DEFAULT_USAGE, fetchBrevo, fetchAws, checkUsage, runUsageCheck };
