// Datenschutz-Schalter für gelbe Daten (Stammdaten, Daten Minderjähriger, personenbezogene Anhänge).
//
//  gelb_lokal  – Automatisierungen dürfen gelbe Daten verarbeiten, solange sie diesen Server nicht verlassen
//                (Regeln für gelbe Vorgänge, meinVerein-Prüfung, Löschfrist). Entscheidung des Vereins.
//  gelb_extern – gelbe Daten dürfen an verbundene Dienste gehen (Microsoft 365: SharePoint-Kopie,
//                Entwürfe im Postfach). Erst nach Klärung der Auftragsverarbeitung (Kap. 4, Anfrage beim Verband).
//
// Der KI-Assistent bekommt unabhängig davon NIE gelbe Daten (DAT-2).
// Die frühere Einstellung „datenschutz_gelb_freigegeben“ gilt als beide Schalter, solange die neuen nicht gesetzt sind.

import { getSetting } from './db.js';

const legacy = () => !!getSetting('datenschutz_gelb_freigegeben', false);

export const gelbLokal = () => {
  const v = getSetting('gelb_lokal', null);
  return v === null ? legacy() : !!v;
};

export const gelbExtern = () => {
  const v = getSetting('gelb_extern', null);
  return v === null ? legacy() : !!v;
};
