const interestIdKey = "orbita-interest-event-id";
const interestConfirmedKey = "orbita-interest-confirmed";

export function interestIsConfirmed() {
  try {
    return localStorage.getItem(interestConfirmedKey) === "true";
  } catch {
    return false;
  }
}

export async function sendInterest(endpoint, referrer = "", eventId = crypto.randomUUID(),
  pageUrl = globalThis.location?.href ?? "") {
    let source = "direct";

    if (referrer) {
      try {
        source = new URL(referrer).hostname;
      } catch {
        // Um referenciador inválido é tratado como acesso direto.
      }
    }

    if (pageUrl) {
      const utmSource = new URL(pageUrl).searchParams.get("utm_source");
      if (utmSource && /^[a-z0-9.-]{1,253}$/i.test(utmSource)) {
        source = utmSource;
      }
    }

    const url = new URL(endpoint, globalThis.location?.origin ?? "https://localhost");
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Endpoint inválido");
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, source}),
      credentials: "omit",
      cache: "no-store",
      keepalive: true,
    });

    if (!response.ok) {
      throw new Error(`Não foi possível registrar o interesse: ${response.status}`);
    }
}

export async function registerInterest() {
  if (interestIsConfirmed()) return;

  const configResponse = await fetch("/config.json", { cache: "no-store" });
  if (!configResponse.ok) throw new Error("Configuração indisponível");

  const config = await configResponse.json();
  if (!config.analyticsEnabled) throw new Error("Registro indisponível");

  let eventId;
  try {
    eventId = localStorage.getItem(interestIdKey);
  } catch {
    // Em navegação privada, o registro ainda pode funcionar sem persistência local.
  }
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const testRegexPattern = (value) => {
    return pattern.test(value)
  }

  if (eventId && !testRegexPattern(eventId)) {
    eventId = null;
  }

  if (!eventId) {
    eventId = crypto.randomUUID();
    try {
      localStorage.setItem(interestIdKey, eventId);
    } catch {
      // O navegador pode bloquear armazenamento local.
    }
  }

  await sendInterest(config.visitsEndpoint ?? "/api/visits", document.referrer, eventId, location.href);

  try {
    localStorage.setItem(interestConfirmedKey, "true");
  } catch {
    // A confirmação permanece na página atual.
  }
}
