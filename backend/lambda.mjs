import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tableName = process.env.VISITS_TABLE;
const defaultTimeZone = "America/Sao_Paulo";

function formatVisitTime(date, country, timeZone) {
  const locale = country === "unknown"
    ? "pt-BR"
    : new Intl.Locale(`und-${country}`).maximize().toString();

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone,
  }).format(date);
}

function getTimeZone(value) {
  if (typeof value !== "string" || value.length > 64) return defaultTimeZone;

  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return value;
  } catch {
    return defaultTimeZone;
  }
}

// Cole este arquivo no index.mjs da Lambda. O handler continua index.handler.
export async function handler(event) {
  const headers = event.headers ?? {};

  if (event.requestContext?.http?.method !== "POST" || event.rawPath !== "/api/visits") {
    return { statusCode: 404 };
  }

  const secret = process.env.ORIGIN_VERIFY_SECRET;
  /*if (!/^[a-f0-9]{64}$/i.test(secret ?? "") || headers["x-origin-verify"] !== secret) {
    return { statusCode: 403 };
  }*/

  let visit;

  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : event.body ?? "";

    if (Buffer.byteLength(body) > 2048) return { statusCode: 413 };
    visit = JSON.parse(body);
  } catch {
    return { statusCode: 400 };
  }

  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!validId.test(visit?.eventId ?? "")) {
    return { statusCode: 400 };
  }

  const source = typeof visit.source === "string" && /^(direct|[a-z0-9.-]{1,253})$/i.test(visit.source)
    ? visit.source
    : "unknown";

  const countryHeader = headers["cloudfront-viewer-country"] ?? "";
  const regionHeader = headers["cloudfront-viewer-country-region"] ?? "";
  const country = /^[A-Z]{2}$/.test(countryHeader) ? countryHeader : "unknown";
  const region = /^[A-Z0-9-]{1,3}$/.test(regionHeader) ? regionHeader : "unknown";
  const timeZone = getTimeZone(headers["cloudfront-viewer-time-zone"]);

  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60;

  try {
    await dynamodb.send(new PutCommand({
      TableName: tableName,
      Item: {
        eventId: visit.eventId,
        visitedAt: now.toISOString(),
        visitedAtLocal: formatVisitTime(now, country, timeZone),
        timeZone,
        source,
        country,
        region,
        expiresAt,
      },
      ConditionExpression: "attribute_not_exists(eventId)",
    }));

    return { statusCode: 204 };
  } catch (error) {
    // Se o mesmo evento chegar duas vezes, não gravamos uma segunda visita.
    if (error.name === "ConditionalCheckFailedException") {
      return { statusCode: 204 };
    }

    console.error("Não foi possível registrar a visita.");
    return { statusCode: 503 };
  }
}
