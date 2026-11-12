// Anbindung an Claude (Anthropic) über das offizielle SDK @anthropic-ai/sdk.
//
// Einsatz in dieser App: ausschließlich als Berater für Automatisierungen (Stufe 1 „Entwurf“).
// Claude schlägt vor – angelegt wird nur, was ein Admin übernimmt, und Regeln brauchen danach
// wie immer eine Freigabe. Claude führt nichts aus und bekommt keine Werkzeuge.
//
// Zugangsdaten: ANTHROPIC_API_KEY in der .env (nie in Datenbank oder Oberfläche).
// Modell: CLAUDE_MODEL (Standard: claude-opus-5-5). Das SDK wird erst beim ersten Aufruf geladen,
// damit die App ohne installiertes Paket weiterläuft.

let sdk = null;
let sdkError = null;
let client = null;

export const MODEL = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';

async function loadSdk() {
  if (sdk || sdkError) return sdk;
  try {
    const [core, helper] = await Promise.all([import('@anthropic-ai/sdk'), import('@anthropic-ai/sdk/helpers/json-schema')]);
    sdk = { Anthropic: core.default, jsonSchemaOutputFormat: helper.jsonSchemaOutputFormat };
  } catch (err) {
    sdkError = err;
  }
  return sdk;
}

/** Ist ein API-Schlüssel hinterlegt? (Das SDK wird dabei noch nicht geladen.) */
export function keyPresent() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function status() {
  await loadSdk();
  return { key: keyPresent(), sdk: !!sdk, sdkError: sdkError ? 'Paket @anthropic-ai/sdk fehlt – auf dem Server „npm install“ ausführen.' : null, model: MODEL() };
}

export class ClaudeError extends Error {
  constructor(message, kind = 'fehler') { super(message); this.kind = kind; }
}

/**
 * Fragt Claude mit strukturierter Ausgabe (JSON-Schema). Gibt { data, usage, model } zurück.
 * Bei Ablehnung aus Sicherheitsgründen: ClaudeError mit kind 'abgelehnt'.
 */
export async function askStructured({ system, prompt, schema, maxTokens = 16000 }) {
  await loadSdk();
  if (!sdk) throw new ClaudeError('Das Paket @anthropic-ai/sdk ist nicht installiert. Auf dem Server im App-Ordner „npm install“ ausführen.');
  if (!keyPresent()) throw new ClaudeError('Kein API-Schlüssel: ANTHROPIC_API_KEY in der .env eintragen und Server neu starten.');
  client ||= new sdk.Anthropic({ timeout: 180_000, maxRetries: 2 });
  let response;
  try {
    // Beta-Endpunkt nur für die Fallback-Option: lehnt das Modell aus Sicherheitsgründen ab,
    // versucht die API es automatisch mit einem passenden anderen Modell.
    response = await client.beta.messages.parse({
      model: MODEL(),
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: sdk.jsonSchemaOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof sdk.Anthropic.AuthenticationError) throw new ClaudeError('Der API-Schlüssel wurde abgelehnt. Bitte in der .env prüfen.');
    if (err instanceof sdk.Anthropic.RateLimitError) throw new ClaudeError('Zu viele Anfragen oder Guthaben aufgebraucht – bitte später erneut versuchen.');
    if (err instanceof sdk.Anthropic.BadRequestError) throw new ClaudeError(`Anfrage abgelehnt: ${err.message}`);
    if (err instanceof sdk.Anthropic.APIConnectionError) throw new ClaudeError('Claude ist nicht erreichbar (Netzwerk).');
    if (err instanceof sdk.Anthropic.APIError) throw new ClaudeError(`Claude-Fehler ${err.status}: ${err.message}`);
    throw new ClaudeError(`Claude-Fehler: ${err.message}`);
  }
  const usage = { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 };
  if (response.stop_reason === 'refusal') {
    throw Object.assign(new ClaudeError('Claude hat die Anfrage aus Sicherheitsgründen abgelehnt.', 'abgelehnt'), { usage });
  }
  if (response.stop_reason === 'max_tokens') throw Object.assign(new ClaudeError('Die Antwort war zu lang und wurde abgeschnitten. Bitte die Anfrage eingrenzen.'), { usage });
  if (!response.parsed_output) throw Object.assign(new ClaudeError('Die Antwort hatte nicht das erwartete Format.'), { usage });
  return { data: response.parsed_output, usage, model: response.model || MODEL() };
}

/** Grobe Kostenschätzung in US-Dollar (nur für das Standardmodell bekannt). */
export function estimateUsd(model, input, output) {
  const prices = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
  const p = prices[model];
  if (!p) return null;
  return Math.round((input * p[0] + output * p[1]) / 1e6 * 10000) / 10000;
}
