// Zentrale Uhr der App.
// Im normalen Betrieb ist sie identisch mit der Systemzeit. Nur der Vorstandsarbeit-Simulator verschiebt sie
// (Zeitraffer), um Wochen und Monate in Minuten durchzuspielen. Alle fachlichen Zeitangaben – Fristen,
// Liegezeiten, Erinnerungen, Zeitstempel – laufen über diese Uhr.
// Bewusst NICHT über diese Uhr: Schutz vor Durchprobieren von Passwörtern und Token-Laufzeiten externer Dienste.

let offsetMs = 0;

/** Aktuelle (ggf. simulierte) Zeit als Date. */
export const clockNow = () => new Date(Date.now() + offsetMs);

/** Aktuelle (ggf. simulierte) Zeit in Millisekunden. */
export const nowMs = () => Date.now() + offsetMs;

/** Verschiebung gegenüber der Systemzeit in Millisekunden (0 im Normalbetrieb). */
export const clockOffset = () => offsetMs;

/** Nur für den Simulator und Tests. */
export function setClockOffset(ms) { offsetMs = Math.max(0, Number(ms) || 0); }
